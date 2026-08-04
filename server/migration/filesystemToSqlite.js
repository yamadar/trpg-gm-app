import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const JSON_SUFFIX = '.json';
const DOCUMENT_SUFFIXES = new Set(['.md', '.txt']);
const MEDIA_SUFFIXES = new Set(['.png', '.webp', '.jpg', '.jpeg']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function posixRelative(root, filename) {
  return path.relative(root, filename).split(path.sep).join('/');
}

async function walk(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) files.push(filename);
    }
  }
  await visit(root);
  return files;
}

function safeOwnerId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && value !== '.'
    && value !== '..'
    && !value.includes('/');
}

function jsonKey(relativePath) {
  return relativePath.slice(0, -JSON_SUFFIX.length);
}

const LEGACY_USER_DIRECTORIES = new Set(['sessions', 'worlds', 'rulesets']);

function targetRelativePath(relativePath, legacyOwnerId) {
  const [root] = relativePath.split('/');
  return legacyOwnerId && LEGACY_USER_DIRECTORIES.has(root)
    ? `users/${legacyOwnerId}/${relativePath}`
    : relativePath;
}

function rootMaps(jsonEntries) {
  const parties = new Map();
  const published = new Map();
  for (const entry of jsonEntries) {
    if (entry.parseError) continue;
    const parts = entry.targetKey.split('/');
    if (parts[0] === 'sharedSessions' && parts.length === 2 && safeOwnerId(entry.value?.ownerId)) {
      parties.set(parts[1], entry.value.ownerId);
    }
    if (parts[0] === 'public' && parts.length === 3 && safeOwnerId(entry.value?.ownerId)) {
      published.set(`${parts[1]}/${parts[2]}`, entry.value.ownerId);
    }
  }
  return { parties, published };
}

function ownershipFor(relativePath, maps) {
  const parts = relativePath.replace(/\.(json|md|txt|png|webp|jpe?g)$/i, '').split('/');
  if (parts[0] === 'users') {
    if (!safeOwnerId(parts[1])) return { known: false, ownerId: null, reason: 'invalid_user_namespace' };
    if (parts[2] === 'sharedSessions') {
      return { known: true, ownerId: null, derived: true };
    }
    return { known: true, ownerId: parts[1] };
  }
  if (parts[0] === 'sharedSessions') {
    const ownerId = maps.parties.get(parts[1]);
    return ownerId
      ? { known: true, ownerId }
      : { known: false, ownerId: null, reason: 'party_owner_missing' };
  }
  if (parts[0] === 'public') {
    if (parts[1] === 'starters') return { known: true, ownerId: null, system: true };
    const ownerId = maps.published.get(`${parts[1]}/${parts[2]}`);
    return ownerId
      ? { known: true, ownerId }
      : { known: false, ownerId: null, reason: 'public_owner_missing' };
  }
  if (parts[0] === 'auth' || parts[0] === 'global') {
    return { known: true, ownerId: null, system: true };
  }
  return { known: false, ownerId: null, reason: 'unrecognized_namespace' };
}

function referenceTargets(entry) {
  const parts = entry.targetKey.split('/');
  const targets = [];
  if (parts[0] === 'users' && parts[2] === 'sharedSessions' && entry.value?.sessionId) {
    targets.push(`sharedSessions/${entry.value.sessionId}`);
  }
  if (parts[0] === 'auth' && parts[1] === 'identities' && entry.value?.userId) {
    targets.push(`users/${entry.value.userId}/profile`);
  }
  if (parts[0] === 'users' && parts[2] === 'publish' && entry.value?.publicId) {
    if (parts[3] === 'sessions') targets.push(`public/novels/${entry.value.publicId}`);
    else if (parts[3] === 'worlds') {
      if (parts[5] === 'characters') targets.push(`public/characters/${entry.value.publicId}`);
      else if (parts[5] === 'scenarios') targets.push(`public/scenarios/${entry.value.publicId}`);
      else targets.push(`public/worlds/${entry.value.publicId}`);
    }
  }
  return targets;
}

function reportChecksum(entries) {
  const hash = crypto.createHash('sha256');
  for (const entry of [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canSupersedeLegacy(entry, current) {
  const sourceUpdatedAt = Number(entry.value?.updatedAt);
  const targetUpdatedAt = Number(current?.updatedAt);
  return entry.legacyRemapped
    && entry.targetKind === 'record'
    && typeof entry.value?.id === 'string'
    && entry.value.id.length > 0
    && entry.value.id === current?.id
    && Number.isFinite(sourceUpdatedAt)
    && Number.isFinite(targetUpdatedAt)
    && targetUpdatedAt >= sourceUpdatedAt;
}

function usageCoordinates(key) {
  let match = key.match(/^users\/([^/]+)\/usage\/(\d{4}-\d{2}-\d{2})$/);
  if (match) return { scope: 'user', ownerId: match[1], day: match[2] };
  match = key.match(/^global\/usage\/(\d{4}-\d{2}-\d{2})$/);
  return match ? { scope: 'global', ownerId: '', day: match[1] } : null;
}

function importUsageCounters(db, key, value, timestamp) {
  const coordinates = usageCoordinates(key);
  if (!coordinates || !value || typeof value !== 'object' || Array.isArray(value)) return;
  const upsert = db.prepare(`
    INSERT INTO usage_counters(scope, owner_id, day, kind, used_units, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, owner_id, day, kind) DO UPDATE SET
      used_units = excluded.used_units,
      updated_at_ms = excluded.updated_at_ms
  `);
  for (const [kind, units] of Object.entries(value)) {
    if (!Number.isSafeInteger(units) || units < 0) continue;
    upsert.run(coordinates.scope, coordinates.ownerId, coordinates.day, kind, units, timestamp);
  }
}

export async function inspectFilesystemData(dataDir, { legacyOwnerId = null } = {}) {
  if (legacyOwnerId != null && !safeOwnerId(legacyOwnerId)) {
    throw new Error('legacyOwnerId is invalid');
  }
  const filenames = await walk(dataDir);
  const rawEntries = [];
  for (const filename of filenames) {
    const relativePath = posixRelative(dataDir, filename);
    const extension = path.extname(relativePath).toLowerCase();
    if (!extension || relativePath.includes('.tmp-')) continue;
    if (!([JSON_SUFFIX].includes(extension) || DOCUMENT_SUFFIXES.has(extension) || MEDIA_SUFFIXES.has(extension))) continue;
    const buffer = await fs.readFile(filename);
    rawEntries.push({
      filename,
      relativePath,
      extension,
      bytes: buffer.length,
      sha256: sha256(buffer),
      buffer,
    });
  }

  const jsonEntries = rawEntries
    .filter((entry) => entry.extension === JSON_SUFFIX)
    .map((entry) => {
      const targetPath = targetRelativePath(entry.relativePath, legacyOwnerId);
      try {
        return {
          ...entry,
          targetPath,
          targetKey: jsonKey(targetPath),
          value: JSON.parse(entry.buffer.toString('utf8')),
        };
      } catch (error) {
        return {
          ...entry,
          targetPath,
          targetKey: jsonKey(targetPath),
          parseError: error.name || 'SyntaxError',
        };
      }
    });
  const maps = rootMaps(jsonEntries);
  const entries = rawEntries.map((entry) => {
    const parsed = entry.extension === JSON_SUFFIX
      ? jsonEntries.find((candidate) => candidate.relativePath === entry.relativePath)
      : { ...entry, targetPath: targetRelativePath(entry.relativePath, legacyOwnerId) };
    const targetKind = entry.extension === JSON_SUFFIX
      ? 'record'
      : DOCUMENT_SUFFIXES.has(entry.extension) ? 'document' : 'media';
    const targetKey = targetKind === 'record' ? parsed.targetKey : parsed.targetPath;
    return {
      ...parsed,
      targetKind,
      targetKey,
      legacyRemapped: parsed.targetPath !== entry.relativePath,
      ownership: ownershipFor(parsed.targetPath, maps),
    };
  }).sort((a, b) => {
    const kindOrder = { record: 0, document: 1, media: 2 };
    return kindOrder[a.targetKind] - kindOrder[b.targetKind]
      || Number(a.legacyRemapped) - Number(b.legacyRemapped)
      || a.relativePath.split('/').length - b.relativePath.split('/').length
      || a.relativePath.localeCompare(b.relativePath);
  });

  const recordKeys = new Set(jsonEntries.filter((entry) => !entry.parseError).map((entry) => entry.targetKey));
  const orphanReferences = [];
  for (const entry of jsonEntries.filter((candidate) => !candidate.parseError)) {
    for (const target of referenceTargets(entry)) {
      if (!recordKeys.has(target)) orphanReferences.push({ source: entry.relativePath, target });
    }
  }
  return { entries, orphanReferences, checksum: reportChecksum(entries) };
}

export async function migrateFilesystemToSqlite({
  dataDir,
  persistence,
  dryRun = false,
  validateOnly = false,
  legacyOwnerId = null,
  allowSupersededLegacy = false,
  now = Date.now,
} = {}) {
  if (!dataDir || !persistence?.db || persistence.driver !== 'sqlite') {
    throw new TypeError('SQLite persistence and dataDir are required');
  }
  if (dryRun && validateOnly) throw new Error('dryRun and validateOnly are mutually exclusive');

  const inspected = await inspectFilesystemData(dataDir, { legacyOwnerId });
  const { db, dataStore, textStore, transaction } = persistence;
  const report = {
    mode: dryRun ? 'dry-run' : validateOnly ? 'validate-only' : 'import',
    generatedAt: now(),
    sourceDir: path.resolve(dataDir),
    checksum: inspected.checksum,
    totals: { files: inspected.entries.length, bytes: 0, records: 0, documents: 0, media: 0 },
    imported: 0,
    adopted: 0,
    superseded: 0,
    retainedMedia: 0,
    copiedMedia: 0,
    skipped: 0,
    validated: 0,
    owners: {},
    quarantined: [],
    validationErrors: [],
    orphanReferences: inspected.orphanReferences,
  };

  const journalGet = db.prepare('SELECT * FROM migration_journal WHERE source_path = ?');
  const journalUpsert = db.prepare(`
    INSERT INTO migration_journal(
      source_path, source_sha256, source_bytes, target_kind, target_key, status, imported_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      source_sha256 = excluded.source_sha256,
      source_bytes = excluded.source_bytes,
      target_kind = excluded.target_kind,
      target_key = excluded.target_key,
      status = excluded.status,
      imported_at_ms = excluded.imported_at_ms
  `);
  const quarantineUpsert = db.prepare(`
    INSERT INTO migration_quarantine(
      source_path, source_sha256, source_bytes, reason, details_json, quarantined_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      source_sha256 = excluded.source_sha256,
      source_bytes = excluded.source_bytes,
      reason = excluded.reason,
      details_json = excluded.details_json,
      quarantined_at_ms = excluded.quarantined_at_ms
  `);
  const quarantineDelete = db.prepare('DELETE FROM migration_quarantine WHERE source_path = ?');
  const missingReferences = new Map();
  for (const orphan of inspected.orphanReferences) {
    const targets = missingReferences.get(orphan.source) || [];
    targets.push(orphan.target);
    missingReferences.set(orphan.source, targets);
  }

  async function existingValue(entry) {
    if (entry.targetKind === 'record') return dataStore.get(entry.targetKey);
    if (entry.targetKind === 'document') return textStore.read(entry.targetKey);
    return null;
  }

  async function quarantine(entry, reason, details = {}) {
    report.quarantined.push({ sourcePath: entry.relativePath, reason, details });
    if (dryRun || validateOnly) return;
    await transaction(() => quarantineUpsert.run(
      entry.relativePath,
      entry.sha256,
      entry.bytes,
      reason,
      JSON.stringify(details),
      now(),
    ));
  }

  for (const entry of inspected.entries) {
    report.totals.bytes += entry.bytes;
    report.totals[entry.targetKind === 'record' ? 'records' : entry.targetKind === 'document' ? 'documents' : 'media'] += 1;
    const ownerKey = entry.ownership.ownerId
      || (entry.ownership.derived ? '(derived)' : entry.ownership.known ? '(system)' : '(unknown)');
    const owner = report.owners[ownerKey] ||= { files: 0, bytes: 0 };
    owner.files += 1;
    owner.bytes += entry.bytes;

    if (entry.parseError) {
      await quarantine(entry, 'json_parse_failed', { errorName: entry.parseError });
      continue;
    }
    if (!entry.ownership.known) {
      await quarantine(entry, entry.ownership.reason);
      continue;
    }
    if (missingReferences.has(entry.relativePath)) {
      await quarantine(entry, 'reference_missing', { targets: missingReferences.get(entry.relativePath) });
      continue;
    }
    if (entry.targetKind === 'media') {
      if (validateOnly) {
        try {
          const current = entry.targetKey === entry.relativePath
            ? await fs.readFile(entry.filename)
            : await persistence.imageStore.read(entry.targetKey);
          if (!current) throw new Error('media_missing');
          if (sha256(current) === entry.sha256) report.validated += 1;
          else report.validationErrors.push({ sourcePath: entry.relativePath, reason: 'media_checksum_mismatch' });
        } catch {
          report.validationErrors.push({ sourcePath: entry.relativePath, reason: 'media_missing' });
        }
      } else if (dryRun) {
        if (entry.targetKey === entry.relativePath) report.retainedMedia += 1;
        else report.copiedMedia += 1;
      } else {
        const journal = journalGet.get(entry.relativePath);
        if (entry.targetKey !== entry.relativePath) {
          const current = await persistence.imageStore.read(entry.targetKey);
          const matches = current && sha256(current) === entry.sha256;
          if (!journal && current && !matches) {
            await quarantine(entry, 'destination_conflict', {
              targetKind: entry.targetKind,
              targetKey: entry.targetKey,
            });
            continue;
          }
          if (!matches) await persistence.imageStore.write(entry.targetKey, entry.buffer);
          await transaction(() => {
            journalUpsert.run(
              entry.relativePath,
              entry.sha256,
              entry.bytes,
              'media',
              entry.targetKey,
              matches ? 'adopted' : 'imported',
              now(),
            );
            quarantineDelete.run(entry.relativePath);
          });
          if (journal?.source_sha256 === entry.sha256 && matches) report.skipped += 1;
          else report.copiedMedia += 1;
          continue;
        }
        await transaction(async () => {
          await persistence.repositories.media.adoptExisting({
            resourceKey: entry.targetKey,
            ownerId: entry.ownership.ownerId,
            objectKey: entry.targetKey,
            sha256: entry.sha256,
            bytes: entry.bytes,
            mimeType: entry.extension === '.png'
              ? 'image/png'
              : entry.extension === '.webp'
                ? 'image/webp'
                : 'image/jpeg',
          });
          if (journal?.source_sha256 !== entry.sha256 || journal.status !== 'retained') {
            journalUpsert.run(
            entry.relativePath, entry.sha256, entry.bytes, 'media', entry.targetKey, 'retained', now(),
            );
          }
        });
        if (journal?.source_sha256 === entry.sha256 && journal.status === 'retained') {
          report.skipped += 1;
        } else {
          report.retainedMedia += 1;
        }
      }
      continue;
    }

    const expected = entry.targetKind === 'record' ? entry.value : entry.buffer.toString('utf8');
    const current = await existingValue(entry);
    const matches = entry.targetKind === 'record' ? sameJson(current, expected) : current === expected;
    const journal = journalGet.get(entry.relativePath);
    if (validateOnly) {
      if (matches || (journal?.status === 'superseded' && canSupersedeLegacy(entry, current))) {
        report.validated += 1;
      }
      else report.validationErrors.push({ sourcePath: entry.relativePath, reason: current === null ? 'target_missing' : 'target_mismatch' });
      continue;
    }
    if (dryRun) continue;

    if (journal?.status === 'superseded') {
      if (canSupersedeLegacy(entry, current)) {
        report.skipped += 1;
      } else {
        await quarantine(entry, 'superseded_target_invalid', {
          targetKind: entry.targetKind,
          targetKey: entry.targetKey,
        });
      }
      continue;
    }
    if (journal?.source_sha256 === entry.sha256 && matches) {
      report.skipped += 1;
      continue;
    }
    if (!journal && current !== null && !matches) {
      if (
        allowSupersededLegacy
        && canSupersedeLegacy(entry, current)
      ) {
        await transaction(() => {
          journalUpsert.run(
            entry.relativePath,
            entry.sha256,
            entry.bytes,
            entry.targetKind,
            entry.targetKey,
            'superseded',
            now(),
          );
          quarantineDelete.run(entry.relativePath);
        });
        report.superseded += 1;
        continue;
      }
      await quarantine(entry, 'destination_conflict', { targetKind: entry.targetKind, targetKey: entry.targetKey });
      continue;
    }
    const status = current !== null && matches ? 'adopted' : 'imported';
    await transaction(async () => {
      if (!matches) {
        if (entry.targetKind === 'record') {
          await dataStore.set(entry.targetKey, expected);
          importUsageCounters(db, entry.targetKey, expected, now());
        } else {
          await textStore.write(entry.targetKey, expected);
        }
      } else if (entry.targetKind === 'record') {
        importUsageCounters(db, entry.targetKey, expected, now());
      }
      journalUpsert.run(
        entry.relativePath,
        entry.sha256,
        entry.bytes,
        entry.targetKind,
        entry.targetKey,
        status,
        now(),
      );
      quarantineDelete.run(entry.relativePath);
    });
    report[status] += 1;
  }

  report.moduleAudit = dryRun ? null : await persistence.auditModules();
  report.ok = report.quarantined.length === 0
    && report.validationErrors.length === 0
    && report.orphanReferences.length === 0
    && (report.moduleAudit?.ok ?? true);
  return report;
}
