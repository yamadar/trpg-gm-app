import fs from 'node:fs/promises';
import path from 'node:path';
import { partySessionKey } from './paths.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const EPHEMERAL_PATHS = [
  /\/presence$/,
  /\/typing$/,
  /^\/text-operations\//,
];

async function directorySize(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await fs.lstat(target)).size;
  }
  return total;
}

async function directorySizeWithout(root, excludedNames) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    if (excludedNames.has(entry.name) || entry.isSymbolicLink()) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await fs.lstat(target)).size;
  }
  return total;
}

async function ownedPartyIds(dataDir, userId) {
  const dir = path.join(dataDir, 'users', userId, 'sharedSessions');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const ids = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const membership = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8'));
      if (membership?.ownerId === userId) ids.push(entry.name.slice(0, -5));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return ids;
}

async function ownedPublicBytes(dataDir, userId) {
  let total = 0;
  for (const type of ['worlds', 'characters', 'scenarios', 'novels']) {
    const dir = path.join(dataDir, 'public', type);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const metaPath = path.join(dir, entry.name);
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        if (meta?.ownerId !== userId) continue;
        total += (await fs.lstat(metaPath)).size;
        total += await directorySize(path.join(dir, entry.name.slice(0, -5)));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return total;
}

export async function userStorageBytes(dataDir, userId) {
  // sharedSessions配下はParty一覧用の派生索引。共有データ本体を所有者へ課金するため、
  // 各参加者へ複製された索引はユーザー容量へ重複計上しない。
  let total = await directorySizeWithout(
    path.join(dataDir, 'users', userId),
    new Set(['sharedSessions']),
  );
  for (const partyId of await ownedPartyIds(dataDir, userId)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(partyId) || partyId === '.' || partyId === '..') continue;
    total += await directorySize(path.join(dataDir, 'sharedSessions', partyId));
  }
  total += await ownedPublicBytes(dataDir, userId);
  return total;
}

const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function createStorageOwnerResolver({ dataStore }) {
  return async function storageOwnerForRequest(req) {
    const match = req.path.match(/^\/party-sessions\/([^/]+)(?:\/|$)/);
    const sessionId = match?.[1];
    if (!sessionId || sessionId === '.' || sessionId === '..' || !SAFE_ID_RE.test(sessionId)) {
      return req.userId;
    }
    const session = await dataStore.get(partySessionKey(sessionId));
    return typeof session?.ownerId === 'string'
      && session.ownerId !== '.'
      && session.ownerId !== '..'
      && SAFE_ID_RE.test(session.ownerId)
      ? session.ownerId
      : req.userId;
  };
}

function storageError(res, status, error, code) {
  res.status(status).json({ error, code });
}

export function createStorageGuard({
  dataDir,
  maxUserBytes = 256 * 1024 * 1024,
  minFreeBytes = 256 * 1024 * 1024,
  writeHeadroomBytes = 12 * 1024 * 1024,
  measureUser = userStorageBytes,
  statfs = fs.statfs,
  ownerIdForRequest = (req) => req.userId,
}) {
  const userReservations = new Map();
  let globalReservedBytes = 0;
  let reservationLock = Promise.resolve();

  function withReservationLock(operation) {
    const run = reservationLock.catch(() => {}).then(operation);
    reservationLock = run;
    return run;
  }

  return async function storageGuard(req, res, next) {
    if (!WRITE_METHODS.has(req.method) || EPHEMERAL_PATHS.some((pattern) => pattern.test(req.path))) {
      next();
      return;
    }
    try {
      await fs.mkdir(dataDir, { recursive: true });
      const resolvedOwnerId = await ownerIdForRequest(req);
      const ownerId = typeof resolvedOwnerId === 'string' && resolvedOwnerId
        ? resolvedOwnerId
        : req.userId;
      const contentLength = Math.max(0, Number(req.get('content-length')) || 0);
      const reservedWrite = Math.max(contentLength, writeHeadroomBytes);
      const reservation = await withReservationLock(async () => {
        const [used, disk] = await Promise.all([
          measureUser(dataDir, ownerId),
          statfs(dataDir),
        ]);
        const userReserved = userReservations.get(ownerId) || 0;
        if (used + userReserved + reservedWrite > maxUserBytes) return { error: 'user' };
        const available = Number(disk.bavail) * Number(disk.bsize);
        if (
          !Number.isFinite(available)
          || available - globalReservedBytes < minFreeBytes + reservedWrite
        ) {
          return { error: 'global' };
        }
        userReservations.set(ownerId, userReserved + reservedWrite);
        globalReservedBytes += reservedWrite;
        return { ok: true };
      });
      if (reservation.error === 'user') {
        storageError(res, 507, 'storage quota exceeded', 'STORAGE_QUOTA_EXCEEDED');
        return;
      }
      if (reservation.error === 'global') {
        storageError(res, 507, 'storage capacity is temporarily unavailable', 'STORAGE_CAPACITY_LOW');
        return;
      }
      let references = 1;
      let finalized = false;
      const releaseReference = () => {
        if (finalized) return;
        references -= 1;
        if (references > 0) return;
        finalized = true;
        void withReservationLock(() => {
          const remaining = Math.max(0, (userReservations.get(ownerId) || 0) - reservedWrite);
          if (remaining) userReservations.set(ownerId, remaining);
          else userReservations.delete(ownerId);
          globalReservedBytes = Math.max(0, globalReservedBytes - reservedWrite);
        });
      };
      req.storageOwnerId = ownerId;
      req.storageReservation = {
        ownerId,
        reservedBytes: reservedWrite,
        retain() {
          if (finalized) return () => {};
          references += 1;
          let retainedReleased = false;
          return () => {
            if (retainedReleased) return;
            retainedReleased = true;
            releaseReference();
          };
        },
      };
      let responseReleased = false;
      const releaseResponseReference = () => {
        if (responseReleased) return;
        responseReleased = true;
        releaseReference();
      };
      res.once('finish', releaseResponseReference);
      res.once('close', releaseResponseReference);
      next();
    } catch (error) {
      next(error);
    }
  };
}
