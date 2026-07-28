import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import { getUserProfile, getPublic } from '../api/shareClient.js';
import PublicItemDetail from '../components/share/PublicItemDetail.jsx';
import PublicItemList from '../components/share/PublicItemList.jsx';
import TabStrip from '../components/nav/TabStrip.jsx';
import { navigate } from '../navigation/useRoute.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import { PUBLIC_TABS as TABS } from '../constants/publicContent.js';
import { useAuth } from '../auth/AuthContext.jsx';

export default function UserPage({ route }) {
  const { user } = useAuth();
  const userId = route.userId;
  const tab = route.userTab;
  const publicId = route.publicId;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfile] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // 自分のページでは認証contextを優先する。プロフィール編集APIの成功と同じ
  // renderで、見出し・頭文字・パンくずまでまとめて新しい値へ切り替わる。
  const shownProfile = profile && user?.id === profile.id ? { ...profile, ...user } : profile;

  // パンくずは「プロフィール段(表示名)」と「末尾(現在地の名前)」を使う。
  // 詳細を開いている間の現在地は公開アイテムなので、末尾はそのタイトルになる。
  // どちらも取得前は登録しない(IDを露出させないため)。
  useBreadcrumbLabel(shownProfile ? shownProfile.displayName : null, 'user');
  useBreadcrumbLabel(publicId ? (detail ? detail.title : null) : shownProfile ? shownProfile.displayName : null);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setLoadError('');
    setProfile(null);

    let cancelled = false;
    (async () => {
      try {
        const p = await getUserProfile(userId);
        if (cancelled) return;
        setProfile(p);
      } catch (e) {
        if (cancelled) return;
        if (e.status === 404) {
          setNotFound(true);
        } else {
          setLoadError('取得に失敗した: ' + e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // 詳細の取得は URL の publicId に従う。戻る/進むでも同じ経路を通る(Gallery と同じ形)。
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

  function goToTab(nextTab) {
    navigate({ name: 'user', userId, userTab: nextTab, publicId: null });
  }

  function openDetail(id) {
    navigate({ name: 'user', userId, userTab: tab, publicId: id });
  }

  const wrapStyle = { maxWidth: 720, margin: '0 auto', padding: '40px 20px' };

  if (loading) {
    return (
      <div style={wrapStyle}>
        <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={wrapStyle}>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.stamp, marginBottom: 16 }}>
          ユーザーが見つかりません
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={wrapStyle}>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.stamp, marginBottom: 16 }}>{loadError}</div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        {shownProfile.avatarUrl ? (
          <img
            src={shownProfile.avatarUrl}
            alt=""
            style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: COLORS.brass,
              color: COLORS.paper,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: F_DISPLAY,
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            {(shownProfile.displayName || '?').slice(0, 1)}
          </div>
        )}
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink }}>{shownProfile.displayName}</div>
          {shownProfile.bio && (
            <p
              style={{
                fontFamily: F_BODY,
                fontSize: 13,
                color: COLORS.inkSoft,
                whiteSpace: 'pre-wrap',
                margin: '4px 0 0',
              }}
            >
              {shownProfile.bio}
            </p>
          )}
        </div>
      </div>

      <TabStrip tabs={TABS} active={tab} onSelect={goToTab} />

      <PublicItemList key={tab} type={tab} ownerId={userId} active={!publicId} onOpenDetail={openDetail} />

      {publicId &&
        (detailLoading ? (
          <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
        ) : detailError ? (
          <div style={{ color: COLORS.stamp, fontSize: 13 }}>{detailError}</div>
        ) : (
          detail && <PublicItemDetail type={tab} item={detail} />
        ))}
    </div>
  );
}
