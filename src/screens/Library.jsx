import { useState, useEffect, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import { LIBRARY_TABS, WORLD_SCOPED_LIBRARY_TABS } from '../constants/libraryTabs.js';
import { navigate } from '../navigation/useRoute.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import WorldTab from './library/WorldTab.jsx';
import CharacterTab from './library/CharacterTab.jsx';
import ScenarioTab from './library/ScenarioTab.jsx';
import CampaignTab from './library/CampaignTab.jsx';
import RulesetTab from './library/RulesetTab.jsx';
import { listWorlds } from '../api/worldLibraryClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import TabStrip from '../components/nav/TabStrip.jsx';

// World ピッカー(<select>)を出すタブ。WORLD_SCOPED_LIBRARY_TABS と違い、
// world タブは含めない。world タブでは WorldTab 自身が World のカード一覧を
// 描画するため、ここでピッカーを重ねると同じ選択肢が二重に表示されてしまう。
const WORLD_PICKER_TABS = WORLD_SCOPED_LIBRARY_TABS.filter((t) => t !== 'world');

export default function Library({ route, campaignFocus = null, onStartCampaignChapter }) {
  const { user, loading: authLoading } = useAuth();
  const tab = route.libraryTab;
  const selectedWorldId = route.worldId;
  const [worlds, setWorlds] = useState([]);
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

  // パンくず末尾に World 名を出す。未取得のうちは登録しない(IDを露出させないため)。
  const selectedWorld = worlds.find((w) => w.id === selectedWorldId);
  useBreadcrumbLabel(selectedWorld ? selectedWorld.title : null);

  function goToTab(nextTab) {
    // World スコープ外のタブへ移るときは worldId を落とす。
    const keepWorld = WORLD_SCOPED_LIBRARY_TABS.includes(nextTab) ? selectedWorldId : null;
    navigate({ name: 'library', libraryTab: nextTab, worldId: keepWorld });
  }

  function goToWorld(worldId) {
    navigate({ name: 'library', libraryTab: tab, worldId: worldId || null });
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 40px' }}>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink, marginBottom: 24 }}>
        素材ライブラリ
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

          <TabStrip tabs={LIBRARY_TABS} active={tab} onSelect={goToTab} />

          {/*
            WORLD_SCOPED_LIBRARY_TABS は「URLの3セグメント目にworldIdを取れるか」を
            答えるための定数で、world タブもそこに含まれる(WorldTab が選択中の
            World を詳細表示するため)。しかし「ピッカーを出すべきか」は別の問いで、
            world タブは WorldTab 自身が World のカード一覧を描画するため、
            ここで重ねてドロップダウンを出すと同じ選択を二重に提供してしまう。
            そのため World タブだけを除いた専用の配列で判定する。
          */}
          {WORLD_PICKER_TABS.includes(tab) && (
            <div style={{ marginBottom: 16 }}>
              <select
                value={selectedWorldId || ''}
                onChange={(e) => goToWorld(e.target.value)}
                style={{
                  fontFamily: F_MONO,
                  fontSize: 13,
                  minHeight: 44,
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
              onSelectWorld={goToWorld}
              onWorldsChanged={refreshWorlds}
            />
          )}
          {tab === 'character' && <CharacterTab worldId={selectedWorldId} />}
          {tab === 'scenario' && <ScenarioTab worldId={selectedWorldId} />}
          {tab === 'campaign' && (
            <CampaignTab
              worldId={selectedWorldId}
              focusCampaignId={campaignFocus?.worldId === selectedWorldId ? campaignFocus.campaignId : null}
              focusSessionId={campaignFocus?.worldId === selectedWorldId ? campaignFocus.sessionId : null}
              onStartChapter={onStartCampaignChapter}
            />
          )}
          {tab === 'ruleset' && <RulesetTab />}
        </>
      )}
    </div>
  );
}
