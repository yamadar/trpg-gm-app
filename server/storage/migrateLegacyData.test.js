// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyData } from './migrateLegacyData.js';

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('migrateLegacyData', () => {
  it('moves legacy top-level dirs under users/{userId} and keeps contents', async () => {
    await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
    await fs.writeFile(path.join(dir, 'sessions', 's1.json'), '{"id":"s1"}');
    await fs.mkdir(path.join(dir, 'worlds', 'w1'), { recursive: true });
    await fs.writeFile(path.join(dir, 'worlds', 'w1.json'), '{"id":"w1"}');

    const moved = await migrateLegacyData(dir, 'usr_1');
    expect(moved.sort()).toEqual(['sessions', 'worlds']);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'users', 'usr_1', 'sessions', 's1.json'), 'utf-8')).id).toBe('s1');
    await expect(fs.access(path.join(dir, 'sessions'))).rejects.toThrow();
  });

  it('skips missing dirs and returns an empty list when nothing to move', async () => {
    expect(await migrateLegacyData(dir, 'usr_1')).toEqual([]);
  });

  it('throws instead of overwriting an existing destination', async () => {
    await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(dir, 'users', 'usr_1', 'sessions'), { recursive: true });
    await expect(migrateLegacyData(dir, 'usr_1')).rejects.toThrow(/already exists/);
  });
});
