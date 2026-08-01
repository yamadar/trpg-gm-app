// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCampaignsRouter } from './campaigns.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { sessionKey, worldDocPath } from '../storage/paths.js';

let dir, dataStore, textStore, generator, app;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  generator = {
    reconcile: vi.fn().mockResolvedValue({
      summary: '橋を落として追手を退けた。',
      proposed_pc_raw: 'PC名: カイ\n所持品: 黒い印章',
      changes: [
        {
          kind: 'canon_fact_add',
          target_id: '',
          title: '北門の橋が崩落',
          details: '軍勢は北門から進入できない。',
          status: '',
          progress: 0,
          visibility: 'all',
          reason: 'PCが橋を爆破した',
          source_log_indexes: [1],
        },
      ],
    }),
    pitches: vi.fn().mockResolvedValue({
      pitches: [
        {
          title: '灰の密使',
          hook: '密使が助けを求める。',
          central_conflict: '印章を巡る争い',
          involved_characters: ['密使'],
          threads: ['黒い印章'],
          timeline_effects: ['軍勢が迂回する'],
          continuity_reasons: ['前章の戦利品が発端'],
          tone: '交渉',
          estimated_length: '2時間',
          consistency_notes: [],
        },
        {
          title: '川底の門',
          hook: '崩れた橋の下に門が現れる。',
          central_conflict: '古代門の封印',
          involved_characters: [],
          threads: ['崩落した橋'],
          timeline_effects: [],
          continuity_reasons: ['前章の破壊が入口を開いた'],
          tone: '探索',
          estimated_length: '3時間',
          consistency_notes: [],
        },
      ],
    }),
    scenario: vi.fn().mockResolvedValue({ title: '灰の密使', raw: '## シナリオ概要\n密使を救う。' }),
  };
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createCampaignsRouter({ dataStore, textStore, generator, now: () => 1000 }));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const body = { title: '影の連鎖', carriedPc: { raw: 'PC名: カイ', xp: 8 }, chapters: [{ sessionId: 's1', title: '第一章', endedAt: 1 }] };

describe('campaigns routes', () => {
  it('upserts and retrieves a campaign', async () => {
    const put = await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    expect(put.status).toBe(200);
    expect(put.body.id).toBe('cp1');
    const get = await request(app).get('/api/worlds/w1/campaigns/cp1');
    expect(get.status).toBe(200);
    expect(get.body.carriedPc).toEqual({ raw: 'PC名: カイ', xp: 8 });
  });
  it('lists campaigns for a world', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    await request(app).put('/api/worlds/w1/campaigns/cp2').send({ ...body, title: 'B' });
    const res = await request(app).get('/api/worlds/w1/campaigns');
    expect(res.body.map((c) => c.id).sort()).toEqual(['cp1', 'cp2']);
  });
  it('returns 404 for a missing campaign', async () => {
    const res = await request(app).get('/api/worlds/w1/campaigns/nope');
    expect(res.status).toBe(404);
  });
  it('returns 400 when title or carriedPc is invalid', async () => {
    expect((await request(app).put('/api/worlds/w1/campaigns/cp1').send({ carriedPc: { raw: 'x', xp: 0 } })).status).toBe(400);
    expect((await request(app).put('/api/worlds/w1/campaigns/cp1').send({ title: 'A', carriedPc: { raw: 'x' } })).status).toBe(400);
  });
  it('deletes a campaign and is idempotent', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    const del = await request(app).delete('/api/worlds/w1/campaigns/cp1');
    expect(del.status).toBe(204);
    expect((await request(app).get('/api/worlds/w1/campaigns/cp1')).status).toBe(404);
    // 未存在でも204(冪等)
    expect((await request(app).delete('/api/worlds/w1/campaigns/cp1')).status).toBe(204);
  });

  it('stores and retrieves the three Campaign source documents', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    const put = await request(app)
      .put('/api/worlds/w1/campaigns/cp1/source/bible')
      .send({ raw: '# 固定事項\n王は行方不明。' });
    expect(put.status).toBe(200);
    expect(put.body.raw).toContain('王は行方不明');
    const get = await request(app).get('/api/worlds/w1/campaigns/cp1/source/bible');
    expect(get.body).toEqual({ kind: 'bible', raw: '# 固定事項\n王は行方不明。' });
    expect((await request(app).put('/api/worlds/w1/campaigns/cp1/source/unknown').send({ raw: 'x' })).status).toBe(404);
  });

  it('reconciles a complete session log, applies selected changes atomically, then generates next story', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send({
      ...body,
      chapters: [{ sessionId: 's1', title: '第一章', status: 'ended', endedAt: 80 }],
    });
    await textStore.write(worldDocPath('usr_test', 'w1'), '# World');
    await request(app).put('/api/worlds/w1/campaigns/cp1/source/bible').send({ raw: '# 原典' });
    const session = {
      id: 's1',
      title: '第一章',
      worldId: 'w1',
      campaignId: 'cp1',
      endedAt: 80,
      updatedAt: 90,
      rulesetId: 'simple',
      pc: { raw: 'PC名: カイ' },
      scenario: { id: 'sc1', raw: '# 第一話' },
      state: { turn_count: 2, xp: 11 },
      log: [
        { role: 'gm', text: '追手が迫る。' },
        { role: 'player', text: '橋を爆破する。' },
      ],
    };
    await dataStore.set(sessionKey('usr_test', 's1'), session);

    const reconciled = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/s1/reconcile')
      .send({});
    expect(reconciled.status).toBe(201);
    expect(reconciled.body.status).toBe('ready');
    expect(reconciled.body.changes).toHaveLength(1);
    expect(generator.reconcile).toHaveBeenCalledWith(expect.objectContaining({ session }));

    // 未精算章が残る間は、古い正史から次話を作らせない。
    const premature = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/next-pitches')
      .send({ requestText: '' });
    expect(premature.status).toBe(409);
    expect(premature.body.code).toBe('PENDING_RECONCILIATION');

    const change = reconciled.body.changes[0];
    const accepted = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/s1/accept')
      .send({
        summary: '橋を落として勝利。',
        pcRaw: 'PC名: カイ\n所持品: 黒い印章',
        changes: [{ ...change, title: '北門大橋が崩落' }],
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.canonRevision).toBe(1);
    expect(accepted.body.carriedPc).toEqual({ raw: 'PC名: カイ\n所持品: 黒い印章', xp: 11 });
    expect(accepted.body.currentState.canonFacts[0].title).toBe('北門大橋が崩落');
    expect(accepted.body.chapters[0]).toMatchObject({ status: 'reconciled', scenarioId: 'sc1' });

    const acceptedAgain = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/s1/accept')
      .send({ changes: [] });
    expect(acceptedAgain.status).toBe(200);
    expect(acceptedAgain.body.canonRevision).toBe(1);

    const reconciledAgain = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/s1/reconcile')
      .send({});
    expect(reconciledAgain.status).toBe(200);
    expect(reconciledAgain.body.status).toBe('accepted');
    expect(generator.reconcile).toHaveBeenCalledTimes(1);

    const staleEdit = await request(app)
      .put('/api/worlds/w1/campaigns/cp1')
      .send({ ...body, canonRevision: 0, chapters: [{ sessionId: 's1', status: 'ended' }] });
    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.code).toBe('STALE_CANON');
    expect((await request(app).get('/api/worlds/w1/campaigns/cp1')).body.canonRevision).toBe(1);

    const pitches = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/next-pitches')
      .send({ requestText: '交渉中心' });
    expect(pitches.status).toBe(201);
    expect(pitches.body.basedOnCanonRevision).toBe(1);
    expect(pitches.body.pitches).toHaveLength(2);
    expect(generator.pitches).toHaveBeenCalledWith(expect.objectContaining({ requestText: '交渉中心' }));

    const pitchId = pitches.body.pitches[0].id;
    const scenario = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/next-scenario')
      .send({ pitchId, instructions: '短編' });
    expect(scenario.status).toBe(201);
    expect(scenario.body).toMatchObject({
      title: '灰の密使',
      pitchId,
      basedOnCanonRevision: 1,
    });
    expect(generator.scenario).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: expect.objectContaining({ id: pitchId }), instructions: '短編' }),
    );
  });

  it('rejects reconciliation acceptance after the source session changes', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send({
      ...body,
      chapters: [{ sessionId: 's1', title: '第一章', status: 'ended', endedAt: 80 }],
    });
    const session = {
      id: 's1', worldId: 'w1', campaignId: 'cp1', endedAt: 80, updatedAt: 90,
      state: { turn_count: 1, xp: 1 }, pc: { raw: 'PC' }, scenario: { raw: 'SC' }, log: [],
    };
    await dataStore.set(sessionKey('usr_test', 's1'), session);
    expect((await request(app).post('/api/worlds/w1/campaigns/cp1/chapters/s1/reconcile')).status).toBe(201);
    await dataStore.set(sessionKey('usr_test', 's1'), { ...session, updatedAt: 91, state: { ...session.state, turn_count: 2 } });

    const accepted = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/s1/accept')
      .send({ acceptedChangeIds: [] });
    expect(accepted.status).toBe(409);
    expect(accepted.body.code).toBe('STALE_SESSION');
  });

  it('reconciles every PC from an ended Party session and stores edited carriedPcs', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send({
      ...body,
      chapters: [{ sessionId: 'party1', title: '二人の遺跡', status: 'ended', endedAt: 80 }],
    });
    const session = {
      id: 'party1',
      mode: 'party',
      title: '二人の遺跡',
      worldId: 'w1',
      campaignId: 'cp1',
      endedAt: 80,
      updatedAt: 90,
      rulesetId: 'simple',
      pcs: [
        { id: 'pc1', characterName: 'カイ', raw: '剣士' },
        { id: 'pc2', characterName: 'ミナ', raw: '学者' },
      ],
      scenario: { id: 'sc_party', raw: '# 遺跡' },
      state: {
        turn_count: 3,
        party: { pcs: { pc1: { xp: 4 }, pc2: { xp: 7 } } },
      },
      log: [
        { role: 'player', text: 'カイ: 正面を守る' },
        { role: 'player', text: 'ミナ: 石碑を読む' },
      ],
    };
    await dataStore.set(sessionKey('usr_test', 'party1'), session);
    generator.reconcile.mockResolvedValueOnce({
      summary: '二人で封印を解いた。',
      proposed_pc_raw: '剣士',
      proposed_pcs: [
        { id: 'pc1', character_name: 'カイ', raw: '剣士\n傷: 左腕', xp: 5 },
        { id: 'pc2', character_name: 'ミナ', raw: '学者\n所持品: 石版', xp: 8 },
      ],
      changes: [],
    });

    const reconciled = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/party1/reconcile')
      .send({});
    expect(reconciled.status).toBe(201);
    expect(reconciled.body.proposedPcs).toEqual([
      { id: 'pc1', characterName: 'カイ', raw: '剣士\n傷: 左腕', xp: 5 },
      { id: 'pc2', characterName: 'ミナ', raw: '学者\n所持品: 石版', xp: 8 },
    ]);

    const accepted = await request(app)
      .post('/api/worlds/w1/campaigns/cp1/chapters/party1/accept')
      .send({
        pcs: [
          reconciled.body.proposedPcs[0],
          { ...reconciled.body.proposedPcs[1], raw: '学者\n所持品: 解読済み石版', xp: 9 },
        ],
        changes: [],
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.carriedPcs).toEqual([
      { id: 'pc1', characterName: 'カイ', raw: '剣士\n傷: 左腕', xp: 5 },
      { id: 'pc2', characterName: 'ミナ', raw: '学者\n所持品: 解読済み石版', xp: 9 },
    ]);
    expect(accepted.body.chapters[0]).toMatchObject({ status: 'reconciled', scenarioId: 'sc_party' });
  });

  it('invalidates generated pitches when a Campaign source document changes', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send({
      ...body,
      canonRevision: 1,
      chapters: [{ sessionId: 's1', title: '第一章', status: 'reconciled', endedAt: 80 }],
    });
    expect((await request(app).post('/api/worlds/w1/campaigns/cp1/next-pitches').send({})).status).toBe(201);
    expect((await request(app).put('/api/worlds/w1/campaigns/cp1/source/cast').send({ raw: '# 更新' })).status).toBe(200);
    expect((await request(app).get('/api/worlds/w1/campaigns/cp1/next-pitches')).status).toBe(404);
  });
});
