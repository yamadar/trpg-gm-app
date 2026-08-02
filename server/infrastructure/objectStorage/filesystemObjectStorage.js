import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

let temporaryCounter = 0;

export function assertObjectKey(value, label = 'object key') {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty relative path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} contains an invalid path segment`);
  }
  return value;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function walkFiles(root, relative = '') {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const output = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await walkFiles(root, child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

export function createFilesystemObjectStorage(rootDir) {
  const root = path.resolve(rootDir);
  const fullPath = (key) => path.join(root, assertObjectKey(key));

  return {
    driver: 'filesystem',
    async write(key, value) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const file = fullPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp-${process.pid}-${temporaryCounter++}`;
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, file);
      return { key, bytes: buffer.length, sha256: sha256(buffer) };
    },
    async read(key) {
      try {
        return await fs.readFile(fullPath(key));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async stat(key) {
      const buffer = await this.read(key);
      if (!buffer) return null;
      return { key, bytes: buffer.length, sha256: sha256(buffer) };
    },
    async list(prefix) {
      assertObjectKey(prefix, 'object prefix');
      const keys = (await walkFiles(root))
        .filter((key) => key === prefix || key.startsWith(`${prefix}/`))
        .sort();
      return Promise.all(keys.map((key) => this.stat(key)));
    },
    async delete(key) {
      try {
        await fs.unlink(fullPath(key));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
    async deleteDir(prefix) {
      await fs.rm(fullPath(prefix), { recursive: true, force: true });
    },
    close() {},
  };
}
