import fs from 'node:fs/promises';
import path from 'node:path';

const LEGACY_DIRS = ['sessions', 'worlds', 'rulesets'];

export async function migrateLegacyData(dataDir, userId) {
  const moved = [];
  for (const name of LEGACY_DIRS) {
    const from = path.join(dataDir, name);
    const to = path.join(dataDir, 'users', userId, name);
    try {
      await fs.access(from);
    } catch {
      continue;
    }
    let destExists = true;
    try {
      await fs.access(to);
    } catch {
      destExists = false;
    }
    if (destExists) throw new Error(`migration destination already exists: ${to}`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    moved.push(name);
  }
  return moved;
}
