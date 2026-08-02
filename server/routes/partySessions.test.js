// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { createPartyService } from '../partyService.js';
import { createPartySessionsRouter } from './partySessions.js';

let dir, dataStore, service, app;
const body = {
  title: '共有卓', worldId: 'w1',
  pcs: [{ id: 'pc1', characterName: 'カイ', raw: '剣士' }, { id: 'pc2', characterName: 'ミナ', raw: '学者' }],
  gmSnapshot: { world: { raw: '秘密World' }, scenario: { raw: '秘密Scenario' }, ruleset: { id: 'simple', formula: 'simple', resourceDefs: [] } },
  settings: { maxPlayers: 2 },
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'party-route-'));
  dataStore = createFsDataStore(dir);
  await dataStore.set('users/host/profile', { displayName: 'ホスト' });
  await dataStore.set('users/player/profile', { displayName: '参加者' });
  service = createPartyService({
    dataStore,
    randomToken: () => 'safe_invite_token',
    generator: vi.fn(async ({ round }) => ({
      resolution: 'advance',
      globalUpdate: { time: '冒頭', historySummary: '', tensionLevel: 0, endingReached: false, flags: {} },
      sceneUpdates: [{ sceneId: 'main', title: '冒頭', location: '', participantPcIds: ['pc1', 'pc2'], summary: '' }],
      pcUpdates: [], narratives: [{ id: `n${round.number}`, audience: { kind: 'all', ids: [] }, text: '導入' }],
      choicesByPc: [], autoActions: [], checkResults: [],
    })),
  });
  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.userId = req.get('X-Test-User') || 'host'; next(); });
  app.use('/api', createPartySessionsRouter({ service }));
});

afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

describe('party session routes', () => {
  it('creates, lists, invites and joins without leaking GM-only snapshots', async () => {
    const created = await request(app).post('/api/party-sessions').send(body);
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body).not.toHaveProperty('gmSnapshot');
    expect((await request(app).get('/api/party-sessions')).body[0]).toMatchObject({ id, status: 'lobby' });

    const invite = await request(app).post(`/api/party-sessions/${id}/invites`).send({});
    expect(invite.status).toBe(201);
    expect(invite.body.inviteToken).toBe('safe_invite_token');
    const joined = await request(app)
      .post(`/api/party-sessions/${id}/join`)
      .set('X-Test-User', 'player')
      .send({ inviteToken: invite.body.inviteToken });
    expect(joined.status).toBe(200);
    expect(joined.body.participants).toHaveLength(2);
    expect(JSON.stringify(joined.body)).not.toContain('秘密Scenario');
    expect(JSON.stringify(joined.body)).not.toContain('秘密World');
  });

  it('rejects non-members and player-only host operations', async () => {
    const created = await request(app).post('/api/party-sessions').send(body);
    const id = created.body.id;
    expect((await request(app).get(`/api/party-sessions/${id}/snapshot`).set('X-Test-User', 'stranger')).status).toBe(403);
    const invite = await request(app).post(`/api/party-sessions/${id}/invites`).send({});
    await request(app).post(`/api/party-sessions/${id}/join`).set('X-Test-User', 'player').send({ inviteToken: invite.body.inviteToken });
    const forbidden = await request(app).post(`/api/party-sessions/${id}/host/pause`).set('X-Test-User', 'player');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('HOST_REQUIRED');
  });

  it('runs the lobby flow through REST commands', async () => {
    const id = (await request(app).post('/api/party-sessions').send(body)).body.id;
    const token = (await request(app).post(`/api/party-sessions/${id}/invites`).send({})).body.inviteToken;
    await request(app).post(`/api/party-sessions/${id}/join`).set('X-Test-User', 'player').send({ inviteToken: token });
    await request(app).post(`/api/party-sessions/${id}/claim`).send({ pcId: 'pc1' });
    await request(app).post(`/api/party-sessions/${id}/claim`).set('X-Test-User', 'player').send({ pcId: 'pc2' });
    await request(app).post(`/api/party-sessions/${id}/ready`);
    await request(app).post(`/api/party-sessions/${id}/ready`).set('X-Test-User', 'player');
    const started = await request(app).post(`/api/party-sessions/${id}/start`);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('playing');
    expect(started.body.round.phase).toBe('collecting');
    expect(started.body.snapshot.narratives[0].text).toBe('導入');
  });
});
