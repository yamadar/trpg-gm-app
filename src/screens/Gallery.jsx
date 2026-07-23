import { useState, useEffect, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { listPublic, getPublic } from '../api/shareClient.js';
import PublicItemDetail, { publicMetaLine } from '../components/share/PublicItemDetail.jsx';

const TABS = [
  { key: 'novels', label: '小説' },
  { key: 'worlds', label: '世界観' },
  { key: 'characters', label: 'キャラクター' },
  { key: 'scenarios', label: 'シナリオ' },
];

const KIND_LABELS = { pc: 'PC', npc: 'NPC' };

export default function Gallery({ onClose }) {
  const [tab, setTab] = useState('novels');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const refresh = useCallback(async (t) => {
    setLoading(true);
    setListError('');
    try {
      setItems(await listPublic(t));
    } catch (e) {
      setListError('一覧の取得に失敗した: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setViewMode('list');
    setDetail(null);
    setDetailError('');
    refresh(tab);
  }, [tab, refresh]);

  async function openDetail(publicId) {
    setViewMode('detail');
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await getPublic(tab, publicId));
    } catch (e) {
      setDetailError('取得に失敗した: ' + e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function backToList() {
    setViewMode('list');
    setDetail(null);
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink }}>公開ギャラリー</div>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      </div>

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

      {viewMode === 'list' ? (
        <>
          {listError && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{listError}</div>}
          {loading ? (
            <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it) => (
                <Card key={it.publicId} onClick={() => openDetail(it.publicId)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{it.title}</div>
                    {tab === 'characters' && (
                      <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark }}>
                        {KIND_LABELS[it.kind] || it.kind}
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginTop: 4 }}>
                    {publicMetaLine(it)}
                  </div>
                  {tab === 'scenarios' && it.recommendedRuleset && (
                    <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginTop: 4 }}>
                      推奨ルール: {it.recommendedRuleset}
                    </div>
                  )}
                </Card>
              ))}
              {items.length === 0 && (
                <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
                  まだ公開されたものがありません
                </div>
              )}
            </div>
          )}
        </>
      ) : detailLoading ? (
        <div>
          <Button variant="ghost" onClick={backToList} style={{ marginBottom: 16 }}>
            ← 一覧に戻る
          </Button>
          <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
        </div>
      ) : detailError ? (
        <div>
          <Button variant="ghost" onClick={backToList} style={{ marginBottom: 16 }}>
            ← 一覧に戻る
          </Button>
          <div style={{ color: COLORS.stamp, fontSize: 13 }}>{detailError}</div>
        </div>
      ) : (
        detail && <PublicItemDetail type={tab} item={detail} onBack={backToList} />
      )}
    </div>
  );
}
