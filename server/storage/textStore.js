import fs from 'node:fs/promises';
import path from 'node:path';

export function createFsTextStore(rootDir) {
  function fullPath(p) {
    return path.join(rootDir, p);
  }

  return {
    async read(p) {
      try {
        return await fs.readFile(fullPath(p), 'utf-8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(p, content) {
      const file = fullPath(p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf-8');
    },
    async list(prefix) {
      const dir = fullPath(prefix);
      try {
        return (await fs.readdir(dir)).map((f) => `${prefix}/${f}`);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    async delete(p) {
      try {
        await fs.unlink(fullPath(p));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
  };
}
