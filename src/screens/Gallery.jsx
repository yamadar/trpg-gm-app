import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import { getPublic } from '../api/shareClient.js';
import PublicItemDetail from '../components/share/PublicItemDetail.jsx';
import PublicItemList from '../components/share/PublicItemList.jsx';
import StarterPackList from '../components/share/StarterPackList.jsx';
import { navigate } from '../navigation/useRoute.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import { GALLERY_TABS as TABS } from '../constants/publicContent.js';
import TabStrip from '../components/nav/TabStrip.jsx';

export default function Gallery({ route, onStartStarter }) {
  const tab = route.browseTab;
  const publicId = route.publicId;

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // 詳細の取得は URL の publicId に従う。戻る/進むでも同じ経路を通る。
  // 追い越しの防止は cancelled フラグだけで足りる。Reactは次のeffect本体より先に
  // 前回のクリーンアップを走らせるため、古いリクエストでは必ず cancelled が先に立つ。
  useEffect(() => {
    if (!publicId) {
      setDetail(null);
      setDetailError('');
      return undefined;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    (async () => {
      try {
        const item = await getPublic(tab, publicId);
        if (cancelled) return;
        setDetail(item);
      } catch (e) {
        if (cancelled) return;
        setDetailError('取得に失敗した: ' + e.message);
      } finally {
        if (!cancelled) setDetailLoading(false);
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

      <TabStrip tabs={TABS} active={tab} onSelect={goToTab} />

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
                  onAuthorClick={(ownerId) => navigate({ name: 'user', userId: ownerId })}
                />
              )
            ))}
        </>
      )}
    </div>
  );
}
