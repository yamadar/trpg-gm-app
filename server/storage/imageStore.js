import fs from 'node:fs/promises';
import path from 'node:path';

let tmpCounter = 0;

export function createFsImageStore(rootDir) {
  function fullPath(p) {
    return path.join(rootDir, p);
  }
  return {
    async write(p, buffer) {
      const file = fullPath(p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
      await fs.writeFile(tmp, buffer);
      await fs.rename(tmp, file);
    },
    async read(p) {
      try {
        return await fs.readFile(fullPath(p));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
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
    async deleteDir(prefix) {
      await fs.rm(fullPath(prefix), { recursive: true, force: true });
    },
  };
}
