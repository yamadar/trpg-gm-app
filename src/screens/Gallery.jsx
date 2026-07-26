import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import { getPublic } from '../api/shareClient.js';
import PublicItemDetail from '../components/share/PublicItemDetail.jsx';
import PublicItemList from '../components/share/PublicItemList.jsx';
import StarterPackList from '../components/share/StarterPackList.jsx';
import { navigate } from '../navigation/useRoute.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import { GALLERY_TABS as TABS } from '../constants/publicContent.js';

export default function Gallery({ route, onStartStarter }) {
  const tab = route.browseTab;
  const publicId = route.publicId;

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailReqRef = useRef(0);

  // 詳細の取得は URL の publicId に従う。戻る/進むでも同じ経路を通る。
  useEffect(() => {
    if (!publicId) {
      setDetail(null);
      setDetailError('');
      return undefined;
    }
    const my = ++detailReqRef.current;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    (async () => {
      try {
        const item = await getPublic(tab, publicId);
        if (cancelled || my !== detailReqRef.current) return;
        setDetail(item);
      } catch (e) {
        if (cancelled || my !== detailReqRef.current) return;
        setDetailError('取得に失敗した: ' + e.message);
      } finally {
        if (!cancelled && my === detailReqRef.current) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, publicId]);

  useBreadcrumbLabel(detail ? detail.title : null);

  function goToTab(nextTab) {
    navigate({ name: 'browse', browseTab: nextTab, publicId: null });
  }

  function openDetail(id) {
    navigate({ name: 'browse', browseTab: tab, publicId: id });
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 40px' }}>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink, marginBottom: 24 }}>
        公開ギャラリー
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => goToTab(t.key)}
              aria-current={active ? 'page' : undefined}
              style={{
                minHeight: 44,
                padding: '6px 14px',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: F_MONO,
                fontSize: 12,
                background: active ? COLORS.ink : 'transparent',
                color: active ? COLORS.paper : COLORS.faint,
                fontWeight: active ? 600 : 400,
                border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
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
            active={!publicId}
            onOpenDetail={openDetail}
            onAuthorClick={(ownerId) => navigate({ name: 'user', userId: ownerId })}
          />

          {publicId &&
            (detailLoading ? (
              <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
            ) : detailError ? (
              <div style={{ color: COLORS.stamp, fontSize: 13 }}>{detailError}</div>
            ) : (
              detail && (
                <PublicItemDetail
                  type={tab}
                  item={detail}
                  onBack={() => goToTab(tab)}
                  onAuthorClick={(ownerId) => navigate({ name: 'user', userId: ownerId })}
                />
              )
            ))}
        </>
      )}
    </div>
  );
}
