import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { listPublic, getPublic } from '../api/shareClient.js';
import PublicItemDetail, { formatPublicDate, authorButtonStyle } from '../components/share/PublicItemDetail.jsx';
import { navigateToUser } from '../router/useHashRoute.js';
import { PUBLIC_TABS as TABS, KIND_LABELS } from '../constants/publicContent.js';

export default function Gallery({ onClose }) {
  const [tab, setTab] = useState('novels');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailReqRef = useRef(0);

  useEffect(() => {
    setViewMode('list');
    setDetail(null);
    setDetailError('');
    setLoading(true);
    setListError('');
    let cancelled = false;
    (async () => {
      try {
        const list = await listPublic(tab);
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setListError('一覧の取得に失敗した: ' + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  async function openDetail(publicId) {
    const my = ++detailReqRef.current;
    setViewMode('detail');
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    try {
      const item = await getPublic(tab, publicId);
      if (my !== detailReqRef.current) return; // 別の詳細取得が始まっていたら破棄
      setDetail(item);
    } catch (e) {
      if (my !== detailReqRef.current) return;
      setDetailError('取得に失敗した: ' + e.message);
    } finally {
      if (my === detailReqRef.current) setDetailLoading(false);
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToUser(it.ownerId);
                      }}
                      style={authorButtonStyle}
                    >
                      {it.ownerName}
                    </button>
                    {` ・ ${formatPublicDate(it)}`}
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
        detail && (
          <PublicItemDetail
            type={tab}
            item={detail}
            onBack={backToList}
            onAuthorClick={(ownerId) => navigateToUser(ownerId)}
          />
        )
      )}
    </div>
  );
}
