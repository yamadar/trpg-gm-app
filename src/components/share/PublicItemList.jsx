import { useEffect, useRef, useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import { listPublic } from '../../api/shareClient.js';
import { formatPublicDate, publicMetaLine, authorButtonStyle } from './PublicItemDetail.jsx';
import { KIND_LABELS } from '../../constants/publicContent.js';
import { MOODS } from '../../constants/moods.js';
import { RULESETS } from '../../data/rulesets.js';

const LIMIT = 20;

function chipStyle(active) {
  return {
    fontFamily: F_MONO,
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 3,
    cursor: 'pointer',
    background: active ? COLORS.ink : 'transparent',
    color: active ? COLORS.paper : COLORS.faint,
    border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
  };
}

export default function PublicItemList({ type, ownerId, onOpenDetail, onAuthorClick }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [ruleset, setRuleset] = useState('');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reqRef = useRef(0);

  const showMoods = type === 'worlds' || type === 'scenarios';
  const showRuleset = type === 'scenarios';
  const moodsKey = selectedMoods.join(',');
  const filtersActive = debouncedQ !== '' || selectedMoods.length > 0 || !!ruleset;

  // 検索入力を300msデバウンスして実効クエリへ反映する。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  async function runFetch(requestOffset, replace) {
    const my = ++reqRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await listPublic(type, {
        q: debouncedQ,
        moods: selectedMoods,
        ruleset,
        ownerId,
        limit: LIMIT,
        offset: requestOffset,
      });
      if (my !== reqRef.current) return; // 別の取得が始まっていたら破棄(stale response guard)
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setHasMore(res.hasMore);
      setOffset(requestOffset);
    } catch (e) {
      if (my !== reqRef.current) return;
      setError('一覧の取得に失敗した: ' + e.message);
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }

  // type / 実効クエリ / 絞り込み / ownerId のいずれかが変わったら offset=0 で取り直す(置換)。
  useEffect(() => {
    setOffset(0);
    runFetch(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, debouncedQ, moodsKey, ruleset, ownerId]);

  function handleMore() {
    runFetch(offset + LIMIT, false);
  }

  function toggleMood(mood) {
    setSelectedMoods((prev) => (prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood]));
  }

  function clearFilters() {
    setQ('');
    setDebouncedQ('');
    setSelectedMoods([]);
    setRuleset('');
  }

  return (
    <div>
      <input
        style={inputStyle}
        placeholder="タイトル・作者名で検索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {showMoods && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {MOODS.map((mood) => (
            <button
              key={mood}
              type="button"
              onClick={() => toggleMood(mood)}
              style={chipStyle(selectedMoods.includes(mood))}
            >
              {mood}
            </button>
          ))}
        </div>
      )}

      {showRuleset && (
        <select
          value={ruleset}
          onChange={(e) => setRuleset(e.target.value)}
          style={{ ...inputStyle, width: 'auto', marginTop: 10 }}
        >
          <option value="">すべて</option>
          {RULESETS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      )}

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {loading && items.length === 0 ? (
          <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
        ) : items.length === 0 && !error ? (
          <div>
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
              {filtersActive ? '条件に合う公開物がありません' : 'まだ公開されたものがありません'}
            </div>
            {filtersActive && (
              <Button variant="ghost" onClick={clearFilters} style={{ marginTop: 12 }}>
                条件をクリア
              </Button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => (
              <Card key={it.publicId} onClick={() => onOpenDetail(it.publicId)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{it.title}</div>
                  {type === 'characters' && (
                    <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark }}>
                      {KIND_LABELS[it.kind] || it.kind}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginTop: 4 }}>
                  {onAuthorClick ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAuthorClick(it.ownerId);
                        }}
                        style={authorButtonStyle}
                      >
                        {it.ownerName}
                      </button>
                      {` ・ ${formatPublicDate(it)}`}
                    </>
                  ) : (
                    publicMetaLine(it)
                  )}
                </div>
                {type === 'scenarios' && it.recommendedRuleset && (
                  <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginTop: 4 }}>
                    推奨ルール: {it.recommendedRuleset}
                  </div>
                )}
              </Card>
            ))}
            {hasMore && (
              <Button
                variant="ghost"
                onClick={handleMore}
                disabled={loading}
                style={{ alignSelf: 'center', marginTop: 8 }}
              >
                {loading ? '読み込み中…' : 'もっと見る'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
