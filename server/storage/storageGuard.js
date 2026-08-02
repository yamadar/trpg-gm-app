import fs from 'node:fs/promises';
import path from 'node:path';

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

export async function userStorageBytes(dataDir, userId) {
  let total = await directorySize(path.join(dataDir, 'users', userId));
  for (const partyId of await ownedPartyIds(dataDir, userId)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(partyId) || partyId === '.' || partyId === '..') continue;
    total += await directorySize(path.join(dataDir, 'sharedSessions', partyId));
  }
  return total;
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
      const contentLength = Math.max(0, Number(req.get('content-length')) || 0);
      const reservedWrite = Math.max(contentLength, writeHeadroomBytes);
      const reservation = await withReservationLock(async () => {
        const [used, disk] = await Promise.all([
          measureUser(dataDir, req.userId),
          statfs(dataDir),
        ]);
        const userReserved = userReservations.get(req.userId) || 0;
        if (used + userReserved + reservedWrite > maxUserBytes) return { error: 'user' };
        const available = Number(disk.bavail) * Number(disk.bsize);
        if (
          !Number.isFinite(available)
          || available - globalReservedBytes < minFreeBytes + reservedWrite
        ) {
          return { error: 'global' };
        }
        userReservations.set(req.userId, userReserved + reservedWrite);
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
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        void withReservationLock(() => {
          const remaining = Math.max(0, (userReservations.get(req.userId) || 0) - reservedWrite);
          if (remaining) userReservations.set(req.userId, remaining);
          else userReservations.delete(req.userId);
          globalReservedBytes = Math.max(0, globalReservedBytes - reservedWrite);
        });
      };
      res.once('finish', release);
      res.once('close', release);
      next();
    } catch (error) {
      next(error);
    }
  };
}
