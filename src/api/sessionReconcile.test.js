import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/index.js', () => ({
  saveSession: vi.fn().mockResolvedValue(true),
}));
vi.mock('./sessionSyncClient.js', () => ({
  getSessionSyncState: vi.fn(),
  getServerSession: vi.fn(),
  rememberSessionSync: vi.fn(),
  dispatchSessionConflict: vi.fn(),
}));

import { saveSession } from '../storage/index.js';
import {
  getServerSession,
  dispatchSessionConflict,
  getSessionSyncState,
  rememberSessionSync,
} from './sessionSyncClient.js';
import { reconcileServerSessions } from './sessionReconcile.js';

beforeEach(() => vi.clearAllMocks());

describe('reconcileServerSessions', () => {
  it('pulls a newer server revision when local progress has not changed', async () => {
    const local = { id: 's1', updatedAt: 100 };
    const remote = { id: 's1', updatedAt: 200, _sync: { revision: 2, clientUpdatedAt: 200 } };
    getSessionSyncState.mockReturnValue({ revision: 1, lastSyncedUpdatedAt: 100 });

    const result = await reconcileServerSessions([local], [remote]);

    expect(saveSession).toHaveBeenCalledWith(remote);
    expect(rememberSessionSync).toHaveBeenCalledWith(remote);
    expect(result.pulledIds).toEqual(['s1']);
  });

  it('keeps both versions and opens conflict resolution when local progress is dirty', async () => {
    const local = { id: 's1', updatedAt: 150 };
    const remote = { id: 's1', updatedAt: 200, _sync: { revision: 2 } };
    getSessionSyncState.mockReturnValue({ revision: 1, lastSyncedUpdatedAt: 100 });

    const result = await reconcileServerSessions([local], [remote]);

    expect(saveSession).not.toHaveBeenCalled();
    expect(dispatchSessionConflict).toHaveBeenCalledWith(local, remote, 'background-sync');
    expect(result.conflicts).toEqual([{ local, remote }]);
  });
});

it('fetches full sessions only for new or changed summary revisions', async () => {
  const local = { id: 's1', updatedAt: 100, _sync: { revision: 1 } };
  getSessionSyncState.mockReturnValue({ revision: 1, lastSyncedUpdatedAt: 100 });
  await reconcileServerSessions([local], [{ id: 's1', _summary: true, _sync: { revision: 1 } }]);
  expect(getServerSession).not.toHaveBeenCalled();
  const remote = { id: 's1', updatedAt: 200, log: [{ text: 'full' }], _sync: { revision: 2 } };
  getServerSession.mockResolvedValue(remote);
  await reconcileServerSessions([local], [{ id: 's1', _summary: true, _sync: { revision: 2 } }]);
  expect(getServerSession).toHaveBeenCalledWith('s1');
  expect(saveSession).toHaveBeenCalledWith(remote);
});
