import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/index.js', () => ({
  saveSession: vi.fn().mockResolvedValue(true),
}));
vi.mock('./sessionSyncClient.js', () => ({
  getSessionSyncState: vi.fn(),
  rememberSessionSync: vi.fn(),
  dispatchSessionConflict: vi.fn(),
}));

import { saveSession } from '../storage/index.js';
import {
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
