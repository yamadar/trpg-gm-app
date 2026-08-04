import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { assertObjectKey } from './filesystemObjectStorage.js';

function normalizePrefix(value) {
  const prefix = String(value || '').replace(/^\/+|\/+$/g, '');
  if (prefix) assertObjectKey(prefix, 'object storage prefix');
  return prefix;
}

function isMissing(error) {
  return error?.name === 'NoSuchKey'
    || error?.name === 'NotFound'
    || error?.$metadata?.httpStatusCode === 404;
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function createS3ObjectStorage({
  bucket,
  region,
  endpoint,
  forcePathStyle = false,
  prefix = '',
  client,
} = {}) {
  if (!String(bucket || '').trim()) throw new Error('OBJECT_STORAGE_BUCKET is required for s3');
  if (!client && !String(region || '').trim()) throw new Error('OBJECT_STORAGE_REGION is required for s3');
  const namespace = normalizePrefix(prefix);
  const s3 = client || new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle,
  });
  const ownsClient = !client;
  const objectKey = (key) => {
    assertObjectKey(key);
    return namespace ? `${namespace}/${key}` : key;
  };
  const resourceKey = (key) => namespace ? key.slice(namespace.length + 1) : key;

  async function listRaw(prefixValue) {
    const fullPrefix = `${objectKey(prefixValue)}/`;
    const rows = [];
    let continuationToken;
    do {
      const page = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const item of page.Contents || []) {
        if (!item.Key) continue;
        rows.push({
          objectKey: item.Key,
          key: resourceKey(item.Key),
          bytes: Number(item.Size || 0),
          etag: item.ETag || null,
        });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return rows;
  }

  return {
    driver: 's3',
    bucket,
    prefix: namespace,
    async write(key, value) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const sha256 = digest(buffer);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey(key),
        Body: buffer,
        ContentLength: buffer.length,
        Metadata: { sha256 },
      }));
      return { key, bytes: buffer.length, sha256 };
    },
    async read(key) {
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        return await bodyToBuffer(result.Body);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async stat(key) {
      try {
        const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
        return {
          key,
          bytes: Number(result.ContentLength || 0),
          sha256: result.Metadata?.sha256 || null,
          etag: result.ETag || null,
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async list(prefixValue) {
      assertObjectKey(prefixValue, 'object prefix');
      return (await listRaw(prefixValue)).map(({ objectKey: ignored, ...row }) => row);
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
    },
    async deleteDir(prefixValue) {
      assertObjectKey(prefixValue, 'object prefix');
      const rows = await listRaw(prefixValue);
      for (let offset = 0; offset < rows.length; offset += 1000) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Quiet: true,
            Objects: rows.slice(offset, offset + 1000).map((row) => ({ Key: row.objectKey })),
          },
        }));
      }
    },
    close() {
      if (ownsClient) s3.destroy();
    },
  };
}
