import { useEffect, useMemo, useState } from 'react';
import { COLORS, F_BODY, F_DISPLAY, F_MONO, inputStyle } from '../theme.js';
import { RULESETS } from '../data/rulesets.js';
import { getAdapter } from '../engine/rulesetAdapters.js';
import { listWorlds, getWorld } from '../api/worldLibraryClient.js';
import { listScenarios, getScenario } from '../api/scenarioLibraryClient.js';
import { listCharacters, getCharacter } from '../api/characterLibraryClient.js';
import { listRulesets } from '../api/rulesetLibraryClient.js';
import { createPartySession } from '../api/partyClient.js';
import FocusHeader from '../components/nav/FocusHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import { navigate } from '../navigation/useRoute.js';
import { characterDisplayName } from '../utils/characterDisplayName.js';

export default function PartySetup({ onCreated, initialContext = null }) {
  const [worlds, setWorlds] = useState([]);
  const [worldId, setWorldId] = useState(initialContext?.worldId || '');
  const [scenarios, setScenarios] = useState([]);
  const [scenarioId, setScenarioId] = useState(initialContext?.scenario?.id || '');
  const [characters, setCharacters] = useState([]);
  const [selectedPcIds, setSelectedPcIds] = useState(() => new Set((initialContext?.pcs || []).map((pc) => pc.id)));
  const [customRulesets, setCustomRulesets] = useState([]);
  const [rulesetId, setRulesetId] = useState(initialContext?.rulesetId || 'simple');
  const [title, setTitle] = useState(initialContext?.title || initialContext?.scenario?.title || '');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [actionTimeoutSeconds, setActionTimeoutSeconds] = useState(90);
  const [voteTimeoutSeconds, setVoteTimeoutSeconds] = useState(30);
  const [viewPolicy, setViewPolicy] = useState('open');
  const [defaultAwayPolicy, setDefaultAwayPolicy] = useState('follow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rulesets = useMemo(() => [...RULESETS, ...customRulesets], [customRulesets]);

  useEffect(() => {
    Promise.all([listWorlds(), listRulesets()])
      .then(([worldItems, ruleItems]) => {
        setWorlds(worldItems);
        setCustomRulesets(ruleItems);
      })
      .catch((e) => setError('素材一覧の取得に失敗した: ' + e.message));
  }, []);

  useEffect(() => {
    const usingContext = initialContext?.worldId === worldId;
    setScenarioId(usingContext ? initialContext?.scenario?.id || '' : '');
    setSelectedPcIds(new Set(usingContext ? (initialContext?.pcs || []).map((pc) => pc.id) : []));
    if (!worldId) {
      setScenarios([]);
      setCharacters([]);
      return;
    }
    Promise.all([listScenarios(worldId), listCharacters(worldId, 'pc')])
      .then(([scenarioItems, pcItems]) => {
        const contextScenario = usingContext && initialContext?.scenario
          ? [initialContext.scenario]
          : [];
        const contextPcs = usingContext
          ? (initialContext?.pcs || []).map((pc) => ({ ...pc, name: pc.id, __campaignPc: true }))
          : [];
        setScenarios([...contextScenario, ...scenarioItems.filter((item) => !contextScenario.some((value) => value.id === item.id))]);
        setCharacters([
          ...contextPcs,
          ...pcItems.filter((item) => !contextPcs.some((value) =>
            value.name === item.name || characterDisplayName(value, 'pc') === characterDisplayName(item, 'pc'),
          )),
        ]);
      })
      .catch((e) => setError('World素材の取得に失敗した: ' + e.message));
  }, [worldId, initialContext]);

  async function handleCreate() {
    if (!worldId || !scenarioId || selectedPcIds.size < 2 || !title.trim()) {
      setError('タイトル、World、Scenario、2人以上のPCを指定してください');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const contextPcById = new Map((initialContext?.pcs || []).map((pc) => [pc.id, pc]));
      const [world, scenario, ...pcs] = await Promise.all([
        initialContext?.worldId === worldId && initialContext.world
          ? initialContext.world
          : getWorld(worldId),
        initialContext?.scenario?.id === scenarioId
          ? initialContext.scenario
          : getScenario(worldId, scenarioId),
        ...[...selectedPcIds].map((pcId) => contextPcById.get(pcId) || getCharacter(worldId, 'pc', pcId)),
      ]);
      const ruleset = rulesets.find((item) => item.id === rulesetId) || RULESETS[0];
      const adapter = getAdapter(ruleset.formula);
      const created = await createPartySession({
        title: title.trim(),
        worldId,
        campaignId: initialContext?.campaignId || null,
        pcs: pcs.map((pc) => ({
          id: pc.name || pc.id,
          characterName: pc.characterName || characterDisplayName(pc, 'pc'),
          raw: pc.raw,
          goal: pc.parsed?.goal || '',
          bonds: pc.parsed?.bonds || '',
        })),
        gmSnapshot: {
          world: { id: world.id, title: world.title, raw: world.raw, moods: world.moods || [] },
          scenario: {
            id: scenario.id,
            title: scenario.title,
            raw: scenario.raw,
            directorGuide: scenario.directorGuide || null,
          },
          ruleset: { ...ruleset, resourceDefs: adapter.resourceDefs },
          directorGuide: scenario.directorGuide || null,
        },
        settings: {
          maxPlayers: Math.min(maxPlayers, pcs.length),
          actionTimeoutSeconds,
          voteTimeoutSeconds,
          viewPolicy,
          defaultAwayPolicy,
        },
      });
      onCreated?.(created.id);
    } catch (e) {
      setError('Party作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <FocusHeader
        title="パーティセッション作成"
        steps={['素材', 'PC', '設定', 'ロビー']}
        currentStep={2}
        exitLabel="やめる"
        onExit={() => navigate({ name: 'home' })}
      />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '36px 20px' }}>
        <Card>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink, marginBottom: 18 }}>
            同じ物語へ招待する
          </div>
          {error && <div style={{ color: COLORS.stamp, fontFamily: F_BODY, fontSize: 13, marginBottom: 14 }}>{error}</div>}
          <Field label="セッション名">
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="World">
            <select value={worldId} onChange={(e) => setWorldId(e.target.value)} style={inputStyle}>
              <option value="">選択</option>
              {worlds.map((world) => <option key={world.id} value={world.id}>{world.title}</option>)}
            </select>
          </Field>
          <Field label="Scenario">
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} style={inputStyle} disabled={!worldId}>
              <option value="">選択</option>
              {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
            </select>
          </Field>
          <Field label="参加PC" hint="参加者はロビーで空いているPCを一人ずつ担当する。2〜6人。">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {characters.map((pc) => (
                <label key={pc.name} style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: F_BODY }}>
                  <input
                    type="checkbox"
                    checked={selectedPcIds.has(pc.name)}
                    disabled={!selectedPcIds.has(pc.name) && selectedPcIds.size >= 6}
                    onChange={(e) => setSelectedPcIds((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(pc.name); else next.delete(pc.name);
                      return next;
                    })}
                  />
                  {characterDisplayName(pc, 'pc')}
                </label>
              ))}
              {worldId && characters.length === 0 && (
                <div style={{ color: COLORS.faint, fontFamily: F_BODY, fontSize: 13 }}>このWorldにPCが無い。素材ライブラリで先に作成する。</div>
              )}
            </div>
          </Field>
          <Field label="ルール">
            <select value={rulesetId} onChange={(e) => setRulesetId(e.target.value)} style={inputStyle}>
              {rulesets.map((ruleset) => <option key={ruleset.id} value={ruleset.id}>{ruleset.label}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <Field label="最大人数">
              <input type="number" min="2" max="6" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label="行動時間（秒）">
              <input type="number" min="15" max="600" value={actionTimeoutSeconds} onChange={(e) => setActionTimeoutSeconds(Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label="投票時間（秒）">
              <input type="number" min="10" max="120" value={voteTimeoutSeconds} onChange={(e) => setVoteTimeoutSeconds(Number(e.target.value))} style={inputStyle} />
            </Field>
          </div>
          <Field label="別行動時の視点公開">
            <select value={viewPolicy} onChange={(e) => setViewPolicy(e.target.value)} style={inputStyle}>
              <option value="open">他Sceneも公開</option>
              <option value="character">自PCが知る描写だけ</option>
            </select>
          </Field>
          <Field label="離席時の既定動作">
            <select value={defaultAwayPolicy} onChange={(e) => setDefaultAwayPolicy(e.target.value)} style={inputStyle}>
              <option value="follow">安全に同行・援護</option>
              <option value="wait">安全な場所で待機</option>
              <option value="delegate">他プレイヤーへ委任</option>
            </select>
          </Field>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginBottom: 14 }}>
            World・ScenarioのGM専用原文は共有Sessionへ複製し、招待参加者へ直接返さない。
          </div>
          <Button variant="brass" onClick={handleCreate} disabled={busy}>
            {busy ? 'ロビー作成中…' : 'ロビーを作成'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
