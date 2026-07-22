import fs from 'node:fs/promises';
import path from 'node:path';

let tmpCounter = 0;

export function createFsDataStore(rootDir) {
  function fullPath(key) {
    return path.join(rootDir, `${key}.json`);
  }

  return {
    async get(key) {
      try {
        const raw = await fs.readFile(fullPath(key), 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async set(key, value) {
      const file = fullPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
      await fs.rename(tmp, file);
    },
    async list(prefix) {
      const dir = path.join(rootDir, prefix);
      try {
        const files = await fs.readdir(dir);
        return files.filter((f) => f.endsWith('.json')).map((f) => `${prefix}/${f.slice(0, -5)}`);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    async delete(key) {
      try {
        await fs.unlink(fullPath(key));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
  };
}
