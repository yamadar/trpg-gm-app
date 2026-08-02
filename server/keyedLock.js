export function createKeyedLock() {
  const locks = new Map();

  return async function withKeyedLock(key, operation) {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  };
}
