import { useState, useEffect, useMemo } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Button from '../components/ui/Button.jsx';
import AchievementRow from '../components/achievements/AchievementRow.jsx';
import AchievementProgressBar from '../components/achievements/AchievementProgressBar.jsx';
import { CATEGORIES } from '../engine/achievementCatalog.js';
import { evaluateAchievements } from '../engine/achievements.js';
import { listEndings } from '../api/endingClient.js';
import { navigateToEndings } from '../router/useHashRoute.js';
import { useAuth } from '../auth/AuthContext.jsx';

const SEGMENTS = [
  { key: 'earned', label: '取得済み' },
  { key: 'locked', label: '未取得' },
  { key: 'all', label: 'すべて' },
];

function Chip({ selected, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        fontFamily: F_MONO,
        fontSize: 11,
        letterSpacing: 0.5,
        padding: '5px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1px solid ${selected ? COLORS.brass : COLORS.line}`,
        background: selected ? COLORS.brass : 'transparent',
        color: selected ? COLORS.paper : COLORS.brassDark,
      }}
    >
      {children}
    </button>
  );
}

export default function AchievementList({ onClose }) {
  const { user } = useAuth();
  const [endings, setEndings] = useState([]);
  const [error, setError] = useState('');
  const [segment, setSegment] = useState('all');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    setError('');
    if (!user) {
      setEndings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listEndings();
        if (!cancelled) {
          setEndings(list);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError('エンディングの取得に失敗した: ' + (e?.message || String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const achievements = useMemo(() => evaluateAchievements(endings), [endings]);
  const earnedCount = achievements.filter((a) => a.earned).length;

  // 件数バッジはカテゴリ絞り込みの影響を受けない全体の数にする。
  // 絞り込むたびに数字が動くと「全体でいくつか」が読めなくなるため。
  const segmentCounts = {
    earned: earnedCount,
    locked: achievements.length - earnedCount,
    all: achievements.length,
  };

  const visible = achievements.filter((a) => {
    if (segment === 'earned' && !a.earned) return false;
    if (segment === 'locked' && a.earned) return false;
    return category === 'all' || a.category === category;
  });

  // セクション内は銅から順に埋まっていくのが見えるよう、ティア昇順→カタログ定義順にする
  const sections = CATEGORIES.map((c) => ({
    ...c,
    items: visible.filter((a) => a.category === c.key).sort((a, b) => a.tier - b.tier),
  })).filter((s) => s.items.length > 0);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ fontFamily: F_DISPLAY, fontSize: 28, color: COLORS.ink, letterSpacing: 1 }}>実績</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="ghost" onClick={navigateToEndings}>
            図鑑へ
          </Button>
          <Button variant="ghost" onClick={onClose}>
            ホームへ
          </Button>
        </div>
      </div>

      {!user && (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginBottom: 24 }}>
          実績の閲覧にはログインが必要です(右上からログイン)
        </div>
      )}

      {error && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 16 }}>{error}</div>
      )}

      {user && (
        <>
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 6 }}>
            {earnedCount} / {achievements.length}
          </div>
          <AchievementProgressBar
            current={earnedCount}
            target={achievements.length}
            label="実績の取得状況"
          />

          {/* 2列とも「すべて」で始まる/終わるチップを持つため、行に名前がないと
              読み上げで順に辿ったときどちらの軸のチップか区別できない */}
          <div
            role="group"
            aria-label="取得状況で絞り込み"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '18px 0 8px' }}
          >
            {SEGMENTS.map((s) => (
              <Chip key={s.key} selected={segment === s.key} onClick={() => setSegment(s.key)}>
                {s.label} {segmentCounts[s.key]}
              </Chip>
            ))}
          </div>
          <div
            role="group"
            aria-label="カテゴリで絞り込み"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}
          >
            <Chip selected={category === 'all'} onClick={() => setCategory('all')}>
              すべて
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.key} selected={category === c.key} onClick={() => setCategory(c.key)}>
                {c.label}
              </Chip>
            ))}
          </div>

          {sections.length === 0 && (
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
              条件に合う実績がありません。
            </div>
          )}

          {sections.map((s) => (
            <div key={s.key} style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark, letterSpacing: 1 }}>
                {s.label}
              </div>
              {s.items.map((a) => (
                <AchievementRow key={a.id} achievement={a} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
