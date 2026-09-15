// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './storage/dataStore.js';
import { createPartyService } from './partyService.js';
import { getPartySession } from './storage/partyLibrary.js';
import { sessionKey } from './storage/paths.js';

let dir, dataStore, service, generator, time;

function outcome(round) {
  return {
    resolution: 'advance',
    globalUpdate: { time: `beat ${round.number}`, historySummary: `round ${round.number}`, tensionLevel: 1, endingReached: false, flags: {} },
    sceneUpdates: [{ sceneId: 'main', title: '共有Scene', location: '', participantPcIds: ['pc1', 'pc2'], summary: '' }],
    pcUpdates: [],
    narratives: [{ id: `n_${round.number}`, audience: { kind: 'all', ids: [] }, text: round.number === 0 ? '導入' : '全行動を解決' }],
    choicesByPc: [], autoActions: [], checkResults: [],
  };
}

const createBody = {
  title: '二人の遺跡', worldId: 'w1',
  pcs: [
    { id: 'pc1', characterName: 'カイ', raw: '剣士' },
    { id: 'pc2', characterName: 'ミナ', raw: '学者' },
  ],
  gmSnapshot: {
    world: { raw: 'GM専用World' }, scenario: { raw: 'GM専用Scenario' },
    ruleset: { id: 'simple', formula: 'simple', resourceDefs: [] },
  },
  settings: { maxPlayers: 2, actionTimeoutSeconds: 90 },
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'party-service-'));
  dataStore = createFsDataStore(dir);
  await dataStore.set('users/host/profile', { id: 'host', displayName: 'ホスト' });
  await dataStore.set('users/player/profile', { id: 'player', displayName: '参加者' });
  time = 1000;
  generator = vi.fn(async ({ round }) => outcome(round));
  service = createPartyService({
    dataStore, generator, logger: vi.fn(), now: () => time, randomToken: () => 'invite_token_123456789',
  });
});

afterEach(async () => { await service.waitForIdle(); await fs.rm(dir, { recursive: true, force: true }); });

async function startAndSettle(userId, id) {
  await service.start(userId, id);
  await service.waitForIdle();
  return service.getSnapshot(userId, id);
}

async function snapshotAndSettle(userId, id) {
  await service.getSnapshot(userId, id);
  await service.waitForIdle();
  return service.getSnapshot(userId, id);
}

async function readyLobby() {
  const created = await service.create('host', createBody);
  const invite = await service.createInvite('host', created.id);
  await service.join('player', created.id, invite.inviteToken);
  await service.claimPc('host', created.id, 'pc1');
  await service.claimPc('player', created.id, 'pc2');
  await service.setReady('host', created.id, true);
  await service.setReady('player', created.id, true);
  return created.id;
}

describe('partyService', () => {
  it('rejects oversized GM snapshots before writing shared storage', async () => {
    await expect(service.create('host', {
      ...createBody,
      gmSnapshot: { ...createBody.gmSnapshot, scenario: { raw: 'x'.repeat(512 * 1024) } },
    })).rejects.toMatchObject({ status: 413, code: 'PARTY_SNAPSHOT_TOO_LARGE' });
  });

  it('caps party sessions owned by one user', async () => {
    for (let index = 0; index < 20; index += 1) {
      await service.create('host', { ...createBody, title: `Party ${index}` });
    }
    await expect(service.create('host', createBody)).rejects.toMatchObject({
      status: 409,
      code: 'PARTY_LIMIT_REACHED',
    });
  });

  it('creates hashed invites, joins members and never projects GM snapshots or another PC raw', async () => {
    const created = await service.create('host', createBody);
    const invite = await service.createInvite('host', created.id);
    expect(invite.inviteToken).toBe('invite_token_123456789');
    const storedInvites = await service.invites('host', created.id);
    expect(storedInvites[0]).not.toHaveProperty('tokenHash');
    await service.join('player', created.id, invite.inviteToken);
    await service.claimPc('player', created.id, 'pc2');
    const playerView = await snapshotAndSettle('player', created.id);
    expect(playerView).not.toHaveProperty('gmSnapshot');
    expect(playerView.pcs.find((pc) => pc.id === 'pc1')).not.toHaveProperty('raw');
    expect(playerView.pcs.find((pc) => pc.id === 'pc2').raw).toBe('学者');
    const stored = await getPartySession(dataStore, created.id);
    expect(stored.gmSnapshot.scenario.raw).toBe('GM専用Scenario');
  });

  it('does not expose another PC private narrative through snapshot or event polling', async () => {
    const id = await readyLobby();
    generator.mockResolvedValueOnce({
      ...outcome({ number: 0 }),
      narratives: [
        { id: 'for_pc1', audience: { kind: 'pcs', ids: ['pc1'] }, text: 'カイだけが見た紋章' },
        { id: 'for_pc2', audience: { kind: 'pcs', ids: ['pc2'] }, text: 'ミナだけが読めた文字' },
      ],
    });
    await startAndSettle('host', id);
    const playerView = await snapshotAndSettle('player', id);
    expect(playerView.snapshot.narratives.map((item) => item.id)).toEqual(['for_pc2']);
    const playerEvents = await service.events('player', id, 0);
    expect(JSON.stringify(playerEvents)).not.toContain('カイだけが見た紋章');
    expect(JSON.stringify(playerEvents)).not.toContain('ミナだけが読めた文字');
  });

  it('collects two actions, waits five-second grace, then calls the AI once for the shared beat', async () => {
    const id = await readyLobby();
    await startAndSettle('host', id);
    expect(generator).toHaveBeenCalledTimes(1); // introduction
    await service.submitIntent('host', id, { text: '扉を開く', commandId: 'cmd_host_1' });
    await service.submitIntent('player', id, { text: '罠を調べる', commandId: 'cmd_player_1' });
    // 再送は同じintentを返し、eventを増やさない。
    await service.submitIntent('host', id, { text: '別文', commandId: 'cmd_host_1' });
    await service.setReady('host', id, true);
    await service.setReady('player', id, true);
    let snapshot = await snapshotAndSettle('host', id);
    expect(snapshot.round.phase).toBe('lock_grace');
    time += 5000;
    snapshot = await snapshotAndSettle('host', id);
    expect(snapshot.round.phase).toBe('collecting');
    expect(snapshot.round.number).toBe(2);
    expect(snapshot.snapshot.narratives.at(-1).text).toBe('全行動を解決');
    expect(snapshot.participants.map((item) => item.activity)).toEqual(['active', 'active']);
    expect(generator).toHaveBeenCalledTimes(2);
    const resolved = generator.mock.calls[1][0].round.resolutionIntents;
    expect(resolved.map((intent) => intent.text)).toEqual(['扉を開く', '罠を調べる']);
  });

  it('extends a deadline while actual typing is active and pauses when no human action exists', async () => {
    const id = await readyLobby();
    await startAndSettle('host', id);
    let snapshot = await snapshotAndSettle('host', id);
    const deadline = snapshot.round.deadlineAt;
    time = deadline - 1000;
    service.touchPresence(id, 'host');
    service.touchPresence(id, 'player');
    await service.heartbeatTyping('player', id);
    time = deadline;
    snapshot = await snapshotAndSettle('host', id);
    expect(snapshot.round.phase).toBe('collecting');
    expect(snapshot.round.deadlineAt).toBe(deadline + 15000);

    // 次は誰も入力せずtyping leaseも切れたため、AIを呼ばず停止。
    time = snapshot.round.deadlineAt;
    service.touchPresence(id, 'host');
    service.touchPresence(id, 'player');
    snapshot = await snapshotAndSettle('host', id);
    expect(snapshot.round.phase).toBe('paused');
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it('does not persist generator exception details in player-visible state or events', async () => {
    const id = await readyLobby();
    generator.mockRejectedValueOnce(new Error('/internal/provider token=SECRET'));
    const snapshot = await startAndSettle('host', id);
    expect(snapshot.round.phase).toBe('paused');
    expect(snapshot.round.error).toContain('AI GM処理に失敗');
    const events = await service.events('host', id, 0);
    expect(JSON.stringify({ snapshot, events })).not.toContain('/internal/provider');
    expect(JSON.stringify({ snapshot, events })).not.toContain('token=SECRET');
  });

  it('keeps chat outside resolution input and supports away/return', async () => {
    const id = await readyLobby();
    await startAndSettle('host', id);
    await service.sendChat('host', id, '北へ行こう', 'chat_cmd_1');
    await service.sendChat('host', id, '重複', 'chat_cmd_1');
    expect((await service.chat('player', id)).messages).toHaveLength(1);
    let snapshot = await service.setAway('player', id, { policy: 'follow' });
    expect(snapshot.participants.find((item) => item.userId === 'player').activity).toBe('away_manual');
    snapshot = await service.returnToParty('player', id);
    expect(snapshot.participants.find((item) => item.userId === 'player').activity).toBe('active');
    expect(generator.mock.calls[0][0]).not.toHaveProperty('chat');
  });

  it('marks a participant away_auto after two consecutive missed rounds', async () => {
    const id = await readyLobby();
    await startAndSettle('host', id);

    for (let miss = 1; miss <= 2; miss += 1) {
      const before = await snapshotAndSettle('host', id);
      await service.submitIntent('host', id, {
        text: `第${miss}ラウンドは仲間を守る`,
        commandId: `cmd_host_miss_${miss}`,
      });
      time = before.round.deadlineAt;
      service.touchPresence(id, 'player');
      const after = await snapshotAndSettle('host', id);
      const absent = after.participants.find((item) => item.userId === 'player');
      expect(absent.consecutiveMisses).toBe(miss);
      expect(absent.activity).toBe(miss === 2 ? 'away_auto' : 'active');
    }
    expect(generator).toHaveBeenCalledTimes(3); // 導入 + 2ラウンド
  });

  it('resolves an exclusive decision by vote and continues the same round once', async () => {
    const id = await readyLobby();
    await startAndSettle('host', id);
    generator.mockResolvedValueOnce({
      resolution: 'decision_required',
      decision: {
        question: '遺跡のどちらへ進む?',
        options: [
          { id: 'north', label: '北門', description: '正面から入る' },
          { id: 'south', label: '南坑道', description: '地下から入る' },
        ],
      },
    });
    await service.submitIntent('host', id, { text: '北門へ進む', commandId: 'cmd_vote_host' });
    await service.submitIntent('player', id, { text: '南坑道へ進む', commandId: 'cmd_vote_player' });
    await service.setReady('host', id, true);
    await service.setReady('player', id, true);
    time += 5000;
    let snapshot = await snapshotAndSettle('host', id);
    expect(snapshot.round.phase).toBe('deciding');
    expect(snapshot.round.decision.question).toBe('遺跡のどちらへ進む?');

    await service.vote('host', id, 'north');
    await service.vote('player', id, 'north');
    snapshot = await snapshotAndSettle('host', id);
    expect(snapshot.round.phase).toBe('collecting');
    expect(snapshot.round.number).toBe(2);
    expect(generator).toHaveBeenCalledTimes(3); // 導入 + 方針判定 + 投票後の描写
    expect(generator.mock.calls[2][0].decisionResult).toMatchObject({ id: 'north', label: '北門' });
  });

  it('exports human and automatic actions for Campaign reconciliation when the host ends', async () => {
    const id = await readyLobby();
    await startAndSettle('host', id);
    const before = await snapshotAndSettle('host', id);
    await service.submitIntent('host', id, { text: '入口を守る', commandId: 'cmd_export_host' });
    time = before.round.deadlineAt;
    service.touchPresence(id, 'player');
    await snapshotAndSettle('host', id);
    await service.end('host', id);

    const exported = await dataStore.get(sessionKey('host', id));
    expect(exported.mode).toBe('party');
    expect(exported.log).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'player', source: 'human', pcId: 'pc1', text: '入口を守る' }),
      expect.objectContaining({ role: 'player', source: 'auto', pcId: 'pc2' }),
      expect.objectContaining({ role: 'gm', text: '全行動を解決' }),
    ]));
  });
});

it('returns resolving promptly to both players while a slow generation is still pending', async () => {
  const id = await readyLobby();
  let complete;
  generator.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const initial = await service.start('host', id);
  expect(initial.round.phase).toBe('resolving');
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  try {
    time += 120_000;
    const views = await Promise.all([service.getSnapshot('host', id), service.getSnapshot('player', id)]);
    expect(views.map((view) => view.round.phase)).toEqual(['resolving', 'resolving']);
    expect(views.every((view) => view.round.deadlineAt === null)).toBe(true);
    await expect(service.hostResume('host', id)).rejects.toMatchObject({ code: 'NOT_PAUSED' });
    expect(generator).toHaveBeenCalledTimes(1);
  } finally { complete(outcome({ number: 0 })); await service.waitForIdle(); }
  expect((await service.getSnapshot('player', id)).round.number).toBe(1);
});

it('keeps long thinking open without a deadline and atomically confirms each latest action', async () => {
  const id = await readyLobby();
  await service.hostUpdateSettings('host', id, { actionTimeoutSeconds: 0 });
  await startAndSettle('host', id);
  time += 600_000;
  service.touchPresence(id, 'player');
  const before = await service.getSnapshot('host', id);
  expect(before.round).toMatchObject({ phase: 'collecting', deadlineAt: null });
  await service.submitIntent('host', id, { text: '十分考えて扉を開ける', roundId: 'round_1', ready: true });
  await service.submitIntent('player', id, { text: '裏側を調べる', roundId: 'round_1', ready: true });
  expect((await service.getSnapshot('player', id)).round.phase).toBe('lock_grace');
  time += 5000;
  const transitioning = await service.getSnapshot('host', id);
  expect(transitioning.round.phase).toBe('resolving');
  await service.waitForIdle();
  expect(generator).toHaveBeenCalledTimes(2);
  expect(generator.mock.calls[1][0].round.resolutionIntents.map((item) => item.text)).toEqual(['十分考えて扉を開ける', '裏側を調べる']);
  await expect(service.submitIntent('host', id, { text: '古い画面', roundId: 'round_1', ready: true })).rejects.toMatchObject({ code: 'ROUND_CHANGED' });
  await expect(service.setReady('host', id, true, 'round_1')).rejects.toMatchObject({ code: 'ROUND_CHANGED' });
  expect((await service.getSnapshot('host', id)).round.intents).toEqual([]);
});

it('retries a failed introduction immediately and preserves a completed adjudication checkpoint', async () => {
  const id = await readyLobby();
  generator.mockImplementationOnce(async ({ onProgress }) => {
    await onProgress('narrating', { plan: { resolution: 'advance' }, checkResults: [{ roll: 13 }] });
    throw Object.assign(new Error('provider secret'), { code: 'PARTY_TRUNCATED' });
  });
  await service.start('host', id);
  await service.waitForIdle();
  const failed = await service.getSnapshot('host', id);
  expect(failed.round.phase).toBe('paused');
  expect(failed.round).not.toHaveProperty('checkpoint');
  await service.returnToParty('player', id);
  expect((await service.getSnapshot('player', id)).round.phase).toBe('paused');
  const retry = await service.hostResume('host', id);
  expect(retry.round).toMatchObject({ number: 0, phase: 'resolving', progress: 'narrating' });
  await service.waitForIdle();
  expect(generator.mock.calls[1][0].round.checkpoint.checkResults).toEqual([{ roll: 13 }]);
  expect((await service.getSnapshot('player', id)).round.number).toBe(1);
});

it('recovers persisted resolving state after a restart without leaving a zero-second screen', async () => {
  const id = await readyLobby();
  // Simulate a crashed process by persisting its last resolving round with no local job.
  const stored = await getPartySession(dataStore, id);
  stored.status = 'playing'; stored.currentRoundId = 'round_0';
  // Use the storage helper rather than depending on its physical key layout.
  const { savePartySession, savePartyRound } = await import('./storage/partyLibrary.js');
  await savePartySession(dataStore, stored);
  await savePartyRound(dataStore, id, { id: 'round_0', number: 0, phase: 'resolving', resolutionId: 'old_job', intents: [], readyUserIds: [], resolutionIntents: [] });
  const view = await service.getSnapshot('host', id);
  expect(view.round.phase).toBe('paused');
  expect(view.round.error).toContain('再起動');
  await service.hostResume('host', id);
  await service.waitForIdle();
  expect((await service.getSnapshot('player', id)).round.number).toBe(1);
});

it('keeps an in-flight round unique under concurrent polls and ignores completion after ending', async () => {
  const id = await readyLobby();
  await startAndSettle('host', id);
  await service.submitIntent('host', id, { text: '扉を開く', ready: true });
  await service.submitIntent('player', id, { text: '調べる', ready: true });
  let complete;
  generator.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  time += 5000;
  const views = await Promise.all(Array.from({ length: 8 }, (_, index) => service.getSnapshot(index % 2 ? 'player' : 'host', id)));
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  try {
    expect(views.every((view) => view.round.phase === 'resolving')).toBe(true);
    expect(generator).toHaveBeenCalledTimes(2);
    await service.end('host', id);
  } finally { complete(outcome({ number: 1 })); await service.waitForIdle(); }
  expect((await service.getSnapshot('player', id)).status).toBe('ended');
});

it('keeps SQLite transactions out of the provider wait and persists progress before returning it', async () => {
  const { createPersistence } = await import('./persistence/createPersistence.js');
  const persistence = createPersistence({ driver: 'sqlite', dataDir: dir });
  dataStore = persistence.scopes.party.dataStore;
  let finish;
  generator = vi.fn(async ({ round, onProgress }) => {
    await onProgress('narrating', { plan: {}, checkResults: [] });
    await new Promise((resolve) => { finish = resolve; });
    return outcome(round);
  });
  service = createPartyService({ dataStore, transaction: persistence.transaction, generator, now: () => time, logger: vi.fn() });
  try {
    const id = await readyLobby();
    expect((await service.start('host', id)).round.phase).toBe('resolving');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await service.getSnapshot('player', id)).round.progress).toBe('narrating');
    await service.sendChat('player', id, '生成中にも相談できる');
    expect((await service.chat('host', id)).messages[0].text).toBe('生成中にも相談できる');
    finish();
    await service.waitForIdle();
    expect((await service.getSnapshot('host', id)).round.number).toBe(1);
    expect(persistence.metrics().rollbacks).toBe(0);
  } finally {
    finish?.();
    await service.waitForIdle();
    persistence.close();
  }
});
