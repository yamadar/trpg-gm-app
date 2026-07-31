import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import MarkdownEditor from '../../components/ui/MarkdownEditor.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import {
  listCampaigns,
  getCampaign,
  putCampaign,
  deleteCampaign,
  getCampaignSource,
  putCampaignSource,
  getCampaignReconciliation,
  reconcileCampaignChapter,
  acceptCampaignReconciliation,
  getCampaignPitches,
  generateCampaignPitches,
  generateCampaignScenario,
} from '../../api/campaignClient.js';
import { getWorld } from '../../api/worldLibraryClient.js';
import { putScenario } from '../../api/scenarioLibraryClient.js';
import { makeId } from '../../utils/makeId.js';

const SOURCE_KINDS = ['bible', 'cast', 'timeline'];
const DETAIL_TABS = [
  { key: 'current', label: '現在' },
  { key: 'cast', label: '人物・勢力' },
  { key: 'timeline', label: '世界の動き' },
  { key: 'chapters', label: '章' },
  { key: 'source', label: '原典' },
  { key: 'pc', label: '引き継ぎPC' },
  { key: 'next', label: '次話を作る' },
];

const SOURCE_DEFAULTS = { bible: '', cast: '', timeline: '' };

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ja-JP');
  } catch {
    return '';
  }
}

function stateGroups(state) {
  return [
    ['確定した事実', state?.canonFacts || []],
    ['人物', state?.characters || []],
    ['勢力', state?.factions || []],
    ['世界の動き', state?.timeline || []],
    ['未解決', state?.openThreads || []],
  ];
}

function StateRecords({ title, records }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>{title}</div>
      {records.length === 0 ? (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ記録なし。</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {records.map((record, index) => (
            <div
              key={record.id || index}
              style={{ borderLeft: `2px solid ${COLORS.brass}`, paddingLeft: 10 }}
            >
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.ink }}>
                {record.title || record.name || record.id}
              </div>
              {(record.details || record.status) && (
                <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>
                  {[record.status, record.details].filter(Boolean).join(' — ')}
                  {Number.isFinite(record.progress) ? ` (${record.progress}%)` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function changeLabel(kind) {
  return {
    canon_fact_add: '事実を追加',
    character_upsert: '人物を更新',
    faction_upsert: '勢力を更新',
    timeline_upsert: '世界の動きを更新',
    thread_open: '未解決事項を追加',
    thread_resolve: '未解決事項を解決',
  }[kind] || kind;
}

export default function CampaignTab({
  worldId,
  focusCampaignId = null,
  focusSessionId = null,
  onStartChapter,
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(focusCampaignId);
  const [loaded, setLoaded] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [sources, setSources] = useState(SOURCE_DEFAULTS);
  const [activeTab, setActiveTab] = useState(focusSessionId ? 'chapters' : 'current');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSources, setNewSources] = useState(SOURCE_DEFAULTS);

  const [draft, setDraft] = useState(null);
  const [draftSummary, setDraftSummary] = useState('');
  const [draftPcRaw, setDraftPcRaw] = useState('');
  const [draftChanges, setDraftChanges] = useState([]);
  const [acceptedChangeIds, setAcceptedChangeIds] = useState(() => new Set());

  const [pitchRequest, setPitchRequest] = useState('');
  const [pitchBundle, setPitchBundle] = useState(null);
  const [selectedPitchId, setSelectedPitchId] = useState(null);
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [scenarioRaw, setScenarioRaw] = useState('');
  const [scenarioPitchId, setScenarioPitchId] = useState(null);
  const detailRequestRef = useRef(0);

  async function refresh() {
    if (!worldId) return;
    try {
      setCampaigns(await listCampaigns(worldId));
      setError('');
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  function showDraft(value) {
    setDraft(value);
    setDraftSummary(value?.summary || '');
    setDraftPcRaw(value?.proposedPcRaw || '');
    setDraftChanges(value?.changes || []);
    // AI提案はまだ正史ではない。GMが確認した項目だけを明示的に採用する。
    setAcceptedChangeIds(new Set());
  }

  async function loadDetail(id, preferredSessionId = null) {
    const requestId = ++detailRequestRef.current;
    const [campaign, sourceResults, pitchResult] = await Promise.all([
      getCampaign(worldId, id),
      Promise.all(
        SOURCE_KINDS.map((kind) => getCampaignSource(worldId, id, kind).catch(() => ({ raw: '' }))),
      ),
      getCampaignPitches(worldId, id).catch(() => null),
    ]);
    const sessionId = preferredSessionId || (campaign.chapters || []).find((ch) => ch.status !== 'reconciled')?.sessionId;
    const existingDraft = sessionId
      ? await getCampaignReconciliation(worldId, id, sessionId).catch(() => null)
      : null;
    // Campaign切替直後、遅く返った旧Campaignの詳細で画面を上書きしない。
    if (detailRequestRef.current !== requestId) return null;
    setLoaded(campaign);
    setEditTitle(campaign.title);
    setSources(Object.fromEntries(SOURCE_KINDS.map((kind, i) => [kind, sourceResults[i].raw || ''])));
    setPitchBundle(pitchResult);
    setSelectedPitchId(null);
    setScenarioTitle('');
    setScenarioRaw('');
    setScenarioPitchId(null);
    showDraft(existingDraft);
    return campaign;
  }

  useEffect(() => {
    detailRequestRef.current += 1;
    setSelectedId(focusCampaignId);
    setLoaded(null);
    setCreating(false);
    setActiveTab(focusSessionId ? 'chapters' : 'current');
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, focusCampaignId, focusSessionId]);

  useEffect(() => {
    if (!selectedId || !worldId) return;
    let cancelled = false;
    setError('');
    loadDetail(selectedId, focusCampaignId === selectedId ? focusSessionId : null).catch((e) => {
      if (!cancelled) setError('取得に失敗した: ' + e.message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, worldId]);

  async function handleCreate() {
    if (!newTitle.trim()) {
      setError('Campaignタイトルを入力してください');
      return;
    }
    setBusy('create');
    setError('');
    try {
      const id = makeId(newTitle);
      await putCampaign(worldId, id, {
        title: newTitle.trim(),
        carriedPc: { raw: '', xp: 0 },
        chapters: [],
        rulesetId: 'simple',
      });
      await Promise.all(
        SOURCE_KINDS.map((kind) => putCampaignSource(worldId, id, kind, newSources[kind] || '')),
      );
      setCreating(false);
      setNewTitle('');
      setNewSources(SOURCE_DEFAULTS);
      setSelectedId(id);
      await refresh();
    } catch (e) {
      setError('作成に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleSave() {
    setBusy('save');
    setError('');
    try {
      const saved = await putCampaign(worldId, selectedId, {
        title: editTitle,
        carriedPc: loaded.carriedPc,
        chapters: loaded.chapters,
        currentState: loaded.currentState,
        canonRevision: loaded.canonRevision,
        rulesetId: loaded.rulesetId,
      });
      await Promise.all(SOURCE_KINDS.map((kind) => putCampaignSource(worldId, selectedId, kind, sources[kind])));
      setLoaded(saved);
      await refresh();
    } catch (e) {
      setError('保存に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleDelete() {
    setBusy('delete');
    setError('');
    try {
      await deleteCampaign(worldId, deleteTarget);
      if (selectedId === deleteTarget) {
        setSelectedId(null);
        setLoaded(null);
      }
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleStartFirstChapter() {
    if (!onStartChapter) return;
    setBusy('start');
    setError('');
    try {
      const world = await getWorld(worldId);
      onStartChapter({
        worldId,
        world: { raw: world.raw, summary: world.raw },
        moods: world.moods || [],
        pcRaw: loaded.carriedPc?.raw || '',
        xp: loaded.carriedPc?.xp || 0,
        rulesetId: loaded.rulesetId || 'simple',
        campaignId: loaded.id,
      });
    } catch (e) {
      setError('第一話の準備に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleReconcile(sessionId) {
    setBusy(`reconcile:${sessionId}`);
    setError('');
    try {
      const value = await reconcileCampaignChapter(worldId, selectedId, sessionId);
      showDraft(value);
      setActiveTab('chapters');
    } catch (e) {
      setError('章の整理に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  function updateDraftChange(index, patch) {
    setDraftChanges((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleAcceptDraft() {
    if (!draft) return;
    setBusy('accept');
    setError('');
    try {
      await acceptCampaignReconciliation(worldId, selectedId, draft.sessionId, {
        summary: draftSummary,
        pcRaw: draftPcRaw,
        changes: draftChanges.filter((change) => acceptedChangeIds.has(change.id)),
      });
      showDraft(null);
      await loadDetail(selectedId);
      await refresh();
      setActiveTab('next');
    } catch (e) {
      setError('正史の更新に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleGeneratePitches() {
    if ((loaded?.chapters || []).some((chapter) => chapter.status !== 'reconciled')) {
      setError('先に未整理の章を正史へ反映してください');
      setActiveTab('chapters');
      return;
    }
    setBusy('pitches');
    setError('');
    try {
      const bundle = await generateCampaignPitches(worldId, selectedId, pitchRequest);
      setPitchBundle(bundle);
      setSelectedPitchId(null);
      setScenarioTitle('');
      setScenarioRaw('');
      setScenarioPitchId(null);
    } catch (e) {
      setError('次話候補の生成に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleGenerateScenario() {
    if (!selectedPitchId) return;
    setBusy('scenario');
    setError('');
    try {
      const value = await generateCampaignScenario(
        worldId,
        selectedId,
        selectedPitchId,
        pitchRequest,
      );
      setScenarioTitle(value.title);
      setScenarioRaw(value.raw);
      setScenarioPitchId(value.pitchId);
    } catch (e) {
      setError('Scenario生成に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  async function handleSaveScenarioAndStart() {
    if (!scenarioRaw.trim() || !onStartChapter) return;
    setBusy('start-next');
    setError('');
    try {
      const scenarioId = makeId(scenarioTitle || 'next-scenario');
      const scenario = await putScenario(worldId, scenarioId, {
        title: scenarioTitle || '次の章',
        raw: scenarioRaw,
        recommendedRuleset: loaded.rulesetId || null,
        moods: [],
        sourceCampaignId: loaded.id,
        sourceCampaignRevision: loaded.canonRevision || 0,
        generatedFromPitchId: scenarioPitchId,
      });
      const world = await getWorld(worldId);
      onStartChapter({
        worldId,
        world: { raw: world.raw, summary: world.raw },
        moods: world.moods || [],
        pcRaw: loaded.carriedPc?.raw || '',
        xp: loaded.carriedPc?.xp || 0,
        rulesetId: loaded.rulesetId || 'simple',
        campaignId: loaded.id,
        scenario: {
          ...scenario,
          sourceCampaignId: loaded.id,
          sourceCampaignRevision: loaded.canonRevision || 0,
          generatedFromPitchId: scenarioPitchId,
        },
      });
    } catch (e) {
      setError('次章の開始準備に失敗した: ' + e.message);
    } finally {
      setBusy('');
    }
  }

  if (!worldId) {
    return (
      <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
        先にWorldタブでWorldを作成・選択してください。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>Campaign一覧</div>
        <Button variant="ghost" onClick={() => setCreating((value) => !value)}>
          {creating ? '作成をやめる' : '+ 新規キャンペーン'}
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {creating && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 15, marginBottom: 14 }}>新規キャンペーン</div>
          <Field label="タイトル">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="原典" hint="物語の前提、テーマ、固定事項、避けたい展開。">
            <MarkdownEditor
              value={newSources.bible}
              onChange={(raw) => setNewSources((current) => ({ ...current, bible: raw }))}
              label="新規Campaign原典"
              minHeight={140}
            />
          </Field>
          <Field label="主要人物・勢力" hint="欲しいもの、恐れ、秘密、妨害がなければ次に何をするか。">
            <MarkdownEditor
              value={newSources.cast}
              onChange={(raw) => setNewSources((current) => ({ ...current, cast: raw }))}
              label="新規Campaign主要人物・勢力"
              minHeight={140}
            />
          </Field>
          <Field label="世界の動き" hint="PCが介入しなかった場合に起きる予定事件。">
            <MarkdownEditor
              value={newSources.timeline}
              onChange={(raw) => setNewSources((current) => ({ ...current, timeline: raw }))}
              label="新規Campaign世界の動き"
              minHeight={140}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={!!busy}>
            {busy === 'create' ? '作成中…' : 'Campaignを作成'}
          </Button>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {campaigns.map((campaign) => (
          <Card
            key={campaign.id}
            onClick={() => setSelectedId(campaign.id)}
            style={{ cursor: 'pointer', borderColor: selectedId === campaign.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{campaign.title}</div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
              全{(campaign.chapters || []).length}章 / 正史rev.{campaign.canonRevision || 0} / 更新 {fmtDate(campaign.updatedAt)}
            </div>
          </Card>
        ))}
        {campaigns.length === 0 && !creating && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
            まだCampaignが無い。「新規キャンペーン」から原典と第一話を準備できる。
          </div>
        )}
      </div>

      {selectedId && loaded && (
        <Card>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <Field label="タイトル">
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
              </Field>
            </div>
            <Button variant="brass" onClick={handleSave} disabled={!!busy}>
              {busy === 'save' ? '保存中…' : '保存'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(selectedId)} disabled={!!busy}>
              削除
            </Button>
          </div>

          <Tabs tabs={DETAIL_TABS} value={activeTab} onChange={setActiveTab} label="Campaign詳細" />

          {activeTab === 'current' && (
            <div role="tabpanel" id="tabpanel-current">
              <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, marginBottom: 12 }}>
                正史 revision {loaded.canonRevision || 0}
              </div>
              {stateGroups(loaded.currentState).map(([title, records]) => (
                <StateRecords key={title} title={title} records={records} />
              ))}
              {(loaded.chapters || []).length === 0 && (
                <Button variant="primary" onClick={handleStartFirstChapter} disabled={!!busy || !onStartChapter}>
                  {busy === 'start' ? '準備中…' : '第一話を始める'}
                </Button>
              )}
            </div>
          )}

          {activeTab === 'cast' && (
            <div role="tabpanel" id="tabpanel-cast">
              <Field label="主要人物・勢力の原典">
                <MarkdownEditor
                  value={sources.cast}
                  onChange={(raw) => setSources((current) => ({ ...current, cast: raw }))}
                  label="Campaign主要人物・勢力"
                  minHeight={220}
                />
              </Field>
              <StateRecords title="現在の人物" records={loaded.currentState?.characters || []} />
              <StateRecords title="現在の勢力" records={loaded.currentState?.factions || []} />
            </div>
          )}

          {activeTab === 'timeline' && (
            <div role="tabpanel" id="tabpanel-timeline">
              <Field label="PCが介入しなかった場合の予定事件">
                <MarkdownEditor
                  value={sources.timeline}
                  onChange={(raw) => setSources((current) => ({ ...current, timeline: raw }))}
                  label="Campaign世界の動き"
                  minHeight={220}
                />
              </Field>
              <StateRecords title="現在の進行" records={loaded.currentState?.timeline || []} />
            </div>
          )}

          {activeTab === 'source' && (
            <div role="tabpanel" id="tabpanel-source">
              <Field label="Campaign原典" hint="AIが自動変更しない固定資料。">
                <MarkdownEditor
                  value={sources.bible}
                  onChange={(raw) => setSources((current) => ({ ...current, bible: raw }))}
                  label="Campaign原典"
                  minHeight={280}
                />
              </Field>
            </div>
          )}

          {activeTab === 'pc' && (
            <div role="tabpanel" id="tabpanel-pc">
              <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 6 }}>
                CP: {loaded.carriedPc?.xp ?? 0}
              </div>
              <pre
                style={{
                  fontFamily: F_BODY,
                  fontSize: 13,
                  color: COLORS.inkSoft,
                  whiteSpace: 'pre-wrap',
                  background: COLORS.card,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 4,
                  padding: '8px 10px',
                  margin: 0,
                }}
              >
                {loaded.carriedPc?.raw || '(PC情報なし。第一話のSetupで作成する)'}
              </pre>
            </div>
          )}

          {activeTab === 'chapters' && (
            <div role="tabpanel" id="tabpanel-chapters">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                {(loaded.chapters || []).map((chapter, index) => (
                  <div key={chapter.sessionId || index} style={{ borderBottom: `1px solid ${COLORS.line}`, paddingBottom: 10 }}>
                    <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.ink }}>
                      第{index + 1}章: {chapter.title}
                    </div>
                    <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, margin: '2px 0 7px' }}>
                      {chapter.status === 'reconciled' ? '正史反映済み' : '結果未整理'} {fmtDate(chapter.endedAt)}
                    </div>
                    {chapter.outcome?.summary && (
                      <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, marginBottom: 7 }}>
                        {chapter.outcome.summary}
                      </div>
                    )}
                    {chapter.status !== 'reconciled' && (
                      <Button
                        variant="ghost"
                        onClick={() => handleReconcile(chapter.sessionId)}
                        disabled={!!busy}
                      >
                        {busy === `reconcile:${chapter.sessionId}` ? '分析中…' : 'プレイ結果を整理'}
                      </Button>
                    )}
                  </div>
                ))}
                {(loaded.chapters || []).length === 0 && (
                  <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>章がまだない。</div>
                )}
              </div>

              {draft && draft.status !== 'accepted' && (
                <div style={{ borderTop: `2px solid ${COLORS.brass}`, paddingTop: 16 }}>
                  <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink, marginBottom: 12 }}>
                    章精算案 — GM確認
                  </div>
                  <Field label="章の要約">
                    <textarea
                      value={draftSummary}
                      onChange={(e) => setDraftSummary(e.target.value)}
                      rows={5}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                    />
                  </Field>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    {draftChanges.length > 0 && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          variant="ghost"
                          onClick={() => setAcceptedChangeIds(new Set(draftChanges.map((change) => change.id)))}
                          disabled={!!busy}
                        >
                          すべて選ぶ
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setAcceptedChangeIds(new Set())}
                          disabled={!!busy}
                        >
                          選択を外す
                        </Button>
                      </div>
                    )}
                    {draftChanges.map((change, index) => (
                      <div key={change.id} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: 10 }}>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark }}>
                          <input
                            type="checkbox"
                            checked={acceptedChangeIds.has(change.id)}
                            onChange={(e) => {
                              setAcceptedChangeIds((current) => {
                                const next = new Set(current);
                                if (e.target.checked) next.add(change.id);
                                else next.delete(change.id);
                                return next;
                              });
                            }}
                          />
                          {changeLabel(change.kind)}
                        </label>
                        <input
                          aria-label={`${changeLabel(change.kind)}のタイトル`}
                          value={change.title}
                          onChange={(e) => updateDraftChange(index, { title: e.target.value })}
                          style={{ ...inputStyle, marginTop: 8 }}
                        />
                        <textarea
                          aria-label={`${changeLabel(change.kind)}の内容`}
                          value={change.details}
                          onChange={(e) => updateDraftChange(index, { details: e.target.value })}
                          rows={3}
                          style={{ ...inputStyle, marginTop: 6, resize: 'vertical', fontFamily: F_BODY }}
                        />
                        {change.reason && (
                          <div style={{ fontFamily: F_BODY, fontSize: 11, color: COLORS.faint, marginTop: 5 }}>
                            根拠: {change.reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <Field label="次章へ引き継ぐPCシート">
                    <textarea
                      value={draftPcRaw}
                      onChange={(e) => setDraftPcRaw(e.target.value)}
                      rows={10}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                    />
                  </Field>
                  <Button variant="brass" onClick={handleAcceptDraft} disabled={!!busy}>
                    {busy === 'accept' ? '正史を更新中…' : '選んだ内容を正史へ反映'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'next' && (
            <div role="tabpanel" id="tabpanel-next">
              {(loaded.chapters || []).some((chapter) => chapter.status !== 'reconciled') && (
                <div style={{ color: COLORS.stamp, fontFamily: F_BODY, fontSize: 12, marginBottom: 12 }}>
                  未整理の章がある。章タブでプレイ結果を正史へ反映してから次話を作る。
                </div>
              )}
              <Field label="今回の要望" hint="登場人物、拾いたい伏線、雰囲気、長さ、避けたい展開。">
                <textarea
                  value={pitchRequest}
                  onChange={(e) => setPitchRequest(e.target.value)}
                  rows={4}
                  placeholder="例: 前話で取り逃がした密偵を中心に、交渉重視の短編"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                />
              </Field>
              <Button
                variant="primary"
                onClick={handleGeneratePitches}
                disabled={!!busy || (loaded.chapters || []).some((chapter) => chapter.status !== 'reconciled')}
              >
                {busy === 'pitches' ? '候補を生成中…' : pitchBundle ? '候補を作り直す' : '次話候補を作る'}
              </Button>

              {pitchBundle && pitchBundle.basedOnCanonRevision !== (loaded.canonRevision || 0) && (
                <div style={{ color: COLORS.stamp, fontFamily: F_BODY, fontSize: 12, marginTop: 10 }}>
                  この候補は古い正史から生成された。候補を作り直してください。
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {(pitchBundle?.pitches || []).map((pitch) => (
                  <Card
                    key={pitch.id}
                    onClick={() => setSelectedPitchId(pitch.id)}
                    style={{ cursor: 'pointer', borderColor: selectedPitchId === pitch.id ? COLORS.brass : COLORS.line }}
                  >
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{pitch.title}</div>
                    <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, marginTop: 5 }}>{pitch.hook}</div>
                    <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint, marginTop: 5 }}>
                      対立: {pitch.centralConflict || '(未設定)'}
                    </div>
                    <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, marginTop: 5 }}>
                      {[pitch.tone, pitch.estimatedLength].filter(Boolean).join(' / ')}
                    </div>
                    {pitch.continuityReasons?.length > 0 && (
                      <div style={{ fontFamily: F_BODY, fontSize: 11, color: COLORS.faint, marginTop: 5 }}>
                        前話との接続: {pitch.continuityReasons.join(' / ')}
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              {selectedPitchId && pitchBundle?.basedOnCanonRevision === (loaded.canonRevision || 0) && (
                <Button
                  variant="brass"
                  onClick={handleGenerateScenario}
                  disabled={!!busy}
                  style={{ marginTop: 14 }}
                >
                  {busy === 'scenario' ? 'Scenario生成中…' : '選択案からScenarioを生成'}
                </Button>
              )}

              {scenarioRaw && (
                <div style={{ borderTop: `2px solid ${COLORS.brass}`, paddingTop: 16, marginTop: 18 }}>
                  <Field label="Scenarioタイトル">
                    <input value={scenarioTitle} onChange={(e) => setScenarioTitle(e.target.value)} style={inputStyle} />
                  </Field>
                  <Field label="Scenario本文" hint="保存前に編集できる。">
                    <MarkdownEditor
                      value={scenarioRaw}
                      onChange={setScenarioRaw}
                      label="生成Scenario本文"
                      minHeight={420}
                    />
                  </Field>
                  <Button variant="brass" onClick={handleSaveScenarioAndStart} disabled={!!busy || !onStartChapter}>
                    {busy === 'start-next' ? '保存中…' : 'Scenarioを保存して次章を始める'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`キャンペーン「${loaded?.title ?? deleteTarget}」を削除する。よいか?`}
        confirmDisabled={!!busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
