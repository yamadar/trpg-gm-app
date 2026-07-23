import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { getUserProfile, getUserPublicItems, getPublic } from '../api/shareClient.js';
import PublicItemDetail, { publicMetaLine } from '../components/share/PublicItemDetail.jsx';
import { clearHash } from '../router/useHashRoute.js';

const TABS = [
  { key: 'novels', label: '小説' },
  { key: 'worlds', label: '世界観' },
  { key: 'characters', label: 'キャラクター' },
  { key: 'scenarios', label: 'シナリオ' },
];

const KIND_LABELS = { pc: 'PC', npc: 'NPC' };

export default function UserPage({ userId }) {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfile] = useState(null);
  const [items, setItems] = useState(null);

  const [tab, setTab] = useState('novels');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setLoadError('');
    setProfile(null);
    setItems(null);
    setTab('novels');
    setViewMode('list');
    setDetail(null);
    setDetailError('');

    (async () => {
      try {
        const [p, i] = await Promise.all([getUserProfile(userId), getUserPublicItems(userId)]);
        setProfile(p);
        setItems(i);
      } catch (e) {
        if (e.status === 404) {
          setNotFound(true);
        } else {
          setLoadError('取得に失敗した: ' + e.message);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

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

  const currentItems = (items && items[tab]) || [];

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
            <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink }}>{profile.displayName}</div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {currentItems.map((it) => (
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
          {currentItems.length === 0 && (
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
              まだ公開されたものがありません
            </div>
          )}
        </div>
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
