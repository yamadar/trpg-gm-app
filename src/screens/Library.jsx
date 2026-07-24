import { useState, useEffect, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import Button from '../components/ui/Button.jsx';
import WorldTab from './library/WorldTab.jsx';
import CharacterTab from './library/CharacterTab.jsx';
import ScenarioTab from './library/ScenarioTab.jsx';
import CampaignTab from './library/CampaignTab.jsx';
import RulesetTab from './library/RulesetTab.jsx';
import { listWorlds } from '../api/worldLibraryClient.js';
import { useAuth } from '../auth/AuthContext.jsx';

const TABS = [
  { key: 'world', label: 'World' },
  { key: 'character', label: 'Character' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'ruleset', label: 'Ruleset' },
];

export default function Library({ onClose }) {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState('world');
  const [worlds, setWorlds] = useState([]);
  const [selectedWorldId, setSelectedWorldId] = useState(null);
  const [worldsError, setWorldsError] = useState('');

  const refreshWorlds = useCallback(async () => {
    try {
      setWorlds(await listWorlds());
      setWorldsError('');
    } catch (e) {
      setWorldsError('World一覧の取得に失敗した: ' + e.message);
    }
  }, []);

  useEffect(() => {
    refreshWorlds();
  }, [refreshWorlds]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink }}>素材ライブラリ</div>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      </div>

      {!user && !authLoading ? (
        <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.inkSoft }}>
          素材ライブラリの利用にはログインが必要です。右上からログインしてください。
        </div>
      ) : (
        <>
          {worldsError && (
            <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{worldsError}</div>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, fontFamily: F_MONO, fontSize: 12 }}>
            {TABS.map((t) => (
              <div
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 3,
                  cursor: 'pointer',
                  background: tab === t.key ? COLORS.ink : 'transparent',
                  color: tab === t.key ? COLORS.paper : COLORS.faint,
                  border: `1px solid ${tab === t.key ? COLORS.ink : COLORS.line}`,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {(tab === 'character' || tab === 'scenario' || tab === 'campaign') && (
            <div style={{ marginBottom: 16 }}>
              <select
                value={selectedWorldId || ''}
                onChange={(e) => setSelectedWorldId(e.target.value || null)}
                style={{
                  fontFamily: F_MONO,
                  fontSize: 13,
                  padding: '8px 10px',
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 4,
                  background: COLORS.card,
                  color: COLORS.inkSoft,
                }}
              >
                <option value="">World: 選択してください</option>
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tab === 'world' && (
            <WorldTab
              worlds={worlds}
              selectedWorldId={selectedWorldId}
              onSelectWorld={setSelectedWorldId}
              onWorldsChanged={refreshWorlds}
            />
          )}
          {tab === 'character' && <CharacterTab worldId={selectedWorldId} />}
          {tab === 'scenario' && <ScenarioTab worldId={selectedWorldId} />}
          {tab === 'campaign' && <CampaignTab worldId={selectedWorldId} />}
          {tab === 'ruleset' && <RulesetTab />}
        </>
      )}
    </div>
  );
}
