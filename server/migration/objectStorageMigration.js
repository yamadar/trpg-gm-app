import crypto from 'node:crypto';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function matchesTarget(targetStorage, objectKey, bytes, hash) {
  const metadata = await targetStorage.stat(objectKey);
  if (!metadata || metadata.bytes !== bytes) return false;
  if (metadata.sha256) return metadata.sha256 === hash;
  const body = await targetStorage.read(objectKey);
  return body !== null && body.length === bytes && sha256(body) === hash;
}

export async function migrateMediaObjects({
  persistence,
  sourceStorage,
  targetStorage,
  targetDriver = 's3',
  dryRun = false,
  validateOnly = false,
  now = Date.now,
} = {}) {
  if (!persistence?.db || !persistence?.repositories?.media) {
    throw new TypeError('SQLite persistence with media repository is required');
  }
  if (!sourceStorage || !targetStorage) throw new TypeError('source and target object storage are required');
  if (dryRun && validateOnly) throw new Error('dryRun and validateOnly are mutually exclusive');

  const report = {
    mode: dryRun ? 'dry-run' : validateOnly ? 'validate-only' : 'import',
    generatedAt: now(),
    targetDriver,
    totals: { objects: 0, bytes: 0 },
    uploaded: 0,
    adopted: 0,
    skipped: 0,
    validated: 0,
    errors: [],
    recoverableAssets: [],
    ok: false,
  };
  const mediaRepository = persistence.repositories.media;
  const recoverable = await mediaRepository.listRecoverable();
  report.recoverableAssets = recoverable.map((asset) => ({
    id: asset.id,
    resourceKey: asset.resourceKey,
    state: asset.state,
  }));
  if (recoverable.length) {
    report.errors.push({ reason: 'media_state_not_settled', count: recoverable.length });
    return report;
  }

  const journalGet = persistence.db.prepare(`
    SELECT source_sha256, source_bytes, target_driver, status
    FROM object_migration_journal WHERE object_key = ?
  `);
  const journalUpsert = persistence.db.prepare(`
    INSERT INTO object_migration_journal(
      object_key, source_sha256, source_bytes, target_driver, status, migrated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(object_key) DO UPDATE SET
      source_sha256 = excluded.source_sha256,
      source_bytes = excluded.source_bytes,
      target_driver = excluded.target_driver,
      status = excluded.status,
      migrated_at_ms = excluded.migrated_at_ms
  `);

  for (const asset of await mediaRepository.listAll()) {
    report.totals.objects += 1;
    report.totals.bytes += asset.bytes;
    let source;
    try {
      source = await sourceStorage.read(asset.objectKey);
    } catch (error) {
      report.errors.push({ objectKey: asset.objectKey, reason: 'source_read_failed', code: error?.name || null });
      continue;
    }
    if (!source) {
      report.errors.push({ objectKey: asset.objectKey, reason: 'source_missing' });
      continue;
    }
    const sourceHash = sha256(source);
    if (source.length !== asset.bytes) {
      report.errors.push({ objectKey: asset.objectKey, reason: 'source_size_mismatch' });
      continue;
    }
    if (asset.sha256 && asset.sha256 !== sourceHash) {
      report.errors.push({ objectKey: asset.objectKey, reason: 'source_checksum_mismatch' });
      continue;
    }

    let targetMatches;
    try {
      targetMatches = await matchesTarget(targetStorage, asset.objectKey, source.length, sourceHash);
    } catch (error) {
      report.errors.push({ objectKey: asset.objectKey, reason: 'target_read_failed', code: error?.name || null });
      continue;
    }

    if (validateOnly) {
      if (targetMatches) report.validated += 1;
      else report.errors.push({ objectKey: asset.objectKey, reason: 'target_missing_or_mismatch' });
      continue;
    }
    if (dryRun) {
      if (targetMatches) report.adopted += 1;
      continue;
    }

    const journal = journalGet.get(asset.objectKey);
    if (targetMatches) {
      if (journal?.source_sha256 === sourceHash && journal?.target_driver === targetDriver) report.skipped += 1;
      else report.adopted += 1;
    } else {
      try {
        const receipt = await targetStorage.write(asset.objectKey, source);
        if (receipt.bytes !== source.length || receipt.sha256 !== sourceHash) {
          throw new Error('target receipt mismatch');
        }
        if (!await matchesTarget(targetStorage, asset.objectKey, source.length, sourceHash)) {
          throw new Error('target verification failed');
        }
        report.uploaded += 1;
      } catch (error) {
        report.errors.push({ objectKey: asset.objectKey, reason: 'target_write_failed', code: error?.name || null });
        continue;
      }
    }
    await persistence.transaction(async () => {
      if (!asset.sha256) await mediaRepository.recordChecksum(asset.id, sourceHash, source.length);
      journalUpsert.run(
        asset.objectKey,
        sourceHash,
        source.length,
        targetDriver,
        targetMatches ? 'adopted' : 'uploaded',
        now(),
      );
    });
  }

  report.ok = report.errors.length === 0
    && (validateOnly ? report.validated === report.totals.objects : true);
  return report;
}
