import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Button from '../components/ui/Button.jsx';
import { getUserProfile, getPublic } from '../api/shareClient.js';
import PublicItemDetail from '../components/share/PublicItemDetail.jsx';
import PublicItemList from '../components/share/PublicItemList.jsx';
import Tabs from '../components/ui/Tabs.jsx';
import { clearHash } from '../router/useHashRoute.js';
import { PUBLIC_TABS as TABS } from '../constants/publicContent.js';

export default function UserPage({ userId }) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfile] = useState(null);

  const [tab, setTab] = useState('novels');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailReqRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setLoadError('');
    setProfile(null);
    setTab('novels');
    setViewMode('list');
    setDetail(null);
    setDetailError('');

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

  const wrapStyle = { maxWidth: 720, margin: '0 auto', padding: '64px 20px 40px' };

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
        <Button variant="ghost" onClick={clearHash}>
          ← 戻る
        </Button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={wrapStyle}>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.stamp, marginBottom: 16 }}>{loadError}</div>
        <Button variant="ghost" onClick={clearHash}>
          ← 戻る
        </Button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
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
              {(profile.displayName || '?').slice(0, 1)}
            </div>
          )}
          <div>
            <h1 style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink, margin: 0 }}>
              {profile.displayName}
            </h1>
            {profile.bio && (
              <p
                style={{
                  fontFamily: F_BODY,
                  fontSize: 13,
                  color: COLORS.inkSoft,
                  whiteSpace: 'pre-wrap',
                  margin: '4px 0 0',
                }}
              >
                {profile.bio}
              </p>
            )}
          </div>
        </div>
        <Button variant="ghost" onClick={clearHash}>
          ← 戻る
        </Button>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="公開物の種類" />

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
      <PublicItemList
        key={tab}
        type={tab}
        ownerId={userId}
        active={viewMode === 'list'}
        onOpenDetail={openDetail}
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
          detail && <PublicItemDetail type={tab} item={detail} onBack={backToList} />
        ))}
      </div>
    </div>
  );
}
