function ownerFromPath(db, resourcePath) {
  const parts = String(resourcePath).split('/');
  if (parts[0] === 'users' && parts[1] && parts[2] !== 'sharedSessions') return parts[1];
  if (parts[0] === 'public' && parts.length >= 3) {
    return db.prepare('SELECT owner_id FROM domain_records WHERE key = ?')
      .get(`public/${parts[1]}/${parts[2]}`)?.owner_id || null;
  }
  if (parts[0] === 'sharedSessions' && parts[1]) {
    return db.prepare('SELECT owner_id FROM domain_records WHERE key = ?')
      .get(`sharedSessions/${parts[1]}`)?.owner_id || null;
  }
  return null;
}

export function createMeteredImageStore({ baseStore, db, storageRepository }) {
  return {
    async write(resourcePath, buffer) {
      const previous = await baseStore.read(resourcePath);
      await baseStore.write(resourcePath, buffer);
      try {
        await storageRepository.setItem('media', resourcePath, ownerFromPath(db, resourcePath), buffer.length);
      } catch (error) {
        if (previous) await baseStore.write(resourcePath, previous);
        else await baseStore.delete(resourcePath);
        throw error;
      }
    },
    read: (resourcePath) => baseStore.read(resourcePath),
    async delete(resourcePath) {
      await baseStore.delete(resourcePath);
      await storageRepository.removeItem('media', resourcePath);
    },
    async deleteDir(prefix) {
      await baseStore.deleteDir(prefix);
      await storageRepository.removePrefix('media', prefix);
    },
  };
}
