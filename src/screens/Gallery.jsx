import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import Button from '../components/ui/Button.jsx';
import { getPublic } from '../api/shareClient.js';
import PublicItemDetail from '../components/share/PublicItemDetail.jsx';
import PublicItemList from '../components/share/PublicItemList.jsx';
import StarterPackList from '../components/share/StarterPackList.jsx';
import { navigateToUser } from '../router/useHashRoute.js';
import { GALLERY_TABS as TABS } from '../constants/publicContent.js';

export default function Gallery({ onClose, onStartStarter }) {
  const [tab, setTab] = useState('starters');

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailReqRef = useRef(0);

  useEffect(() => {
    setViewMode('list');
    setDetail(null);
    setDetailError('');
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

      {/* starters は公開アイテムの一覧/詳細ではなく「まとめて取り込む単位」なので、
          /api/public/:type の TYPES にも属さない。ここだけ別コンポーネントを描画する。 */}
      {tab === 'starters' ? (
        <StarterPackList onImported={onStartStarter} />
      ) : (
        <>
          <PublicItemList
            key={tab}
            type={tab}
            active={viewMode === 'list'}
            onOpenDetail={openDetail}
            onAuthorClick={(ownerId) => navigateToUser(ownerId)}
          />

          {viewMode !== 'list' &&
            (detailLoading ? (
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
            ))}
        </>
      )}
    </div>
  );
}
