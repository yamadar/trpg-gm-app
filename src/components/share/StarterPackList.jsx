import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { RULESETS } from '../../data/rulesets.js';
import { listStarters, importStarterPack } from '../../api/starterClient.js';

function rulesetLabel(id) {
  return RULESETS.find((r) => r.id === id)?.label ?? id;
}

export default function StarterPackList({ onImported }) {
  const [packs, setPacks] = useState([]);
  // 複数カードを並行して操作できるので、busy/errors はどちらも packId をキーにした
  // オブジェクトで持つ(単一スカラーだと他カードの操作でこのカードの状態が上書きされる)。
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  // アンマウント後の setState を防ぐ。onImported で親が画面遷移し、start() の
  // 完了待ちの間にこのコンポーネントごと外れるケースがあるため。
  const aliveRef = useRef(true);

  useEffect(() => {
    let alive = true;
    listStarters()
      .then((m) => alive && setPacks(m?.packs ?? []))
      // 取得できないことは「まだ無い」と同じ扱いにする。ここでエラーを出すと、
      // スターター未シードの環境で Home / Gallery に無関係な赤字が出続ける。
      .catch(() => alive && setPacks([]));
    return () => {
      alive = false;
      aliveRef.current = false;
    };
  }, []);

  async function start(pack) {
    setBusy((prev) => ({ ...prev, [pack.packId]: true }));
    setErrors((prev) => ({ ...prev, [pack.packId]: '' }));
    try {
      const result = await importStarterPack(pack.packId);
      onImported({
        world: result.world,
        scenario: result.scenario,
        rulesetId: pack.recommendedRuleset,
      });
    } catch (e) {
      if (aliveRef.current) {
        setErrors((prev) => ({ ...prev, [pack.packId]: '取り込みに失敗した: ' + e.message }));
      }
    } finally {
      if (aliveRef.current) {
        setBusy((prev) => ({ ...prev, [pack.packId]: false }));
      }
    }
  }

  if (packs.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {packs.map((pack) => (
        <Card key={pack.packId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{pack.title}</div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap' }}>
              {rulesetLabel(pack.recommendedRuleset)}
            </div>
          </div>

          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, marginTop: 6 }}>{pack.tagline}</div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {(pack.moods ?? []).map((m, i) => (
              <Badge key={`${m}-${i}`}>{m}</Badge>
            ))}
            <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>{pack.scenarioTitle}</span>
          </div>

          {pack.source && (
            <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 8 }}>{pack.source}</div>
          )}

          <div style={{ marginTop: 12 }}>
            <Button variant="brass" onClick={() => start(pack)} disabled={!!busy[pack.packId]}>
              {busy[pack.packId] ? '取り込み中…' : 'この冒険を始める'}
            </Button>
          </div>

          {errors[pack.packId] && (
            <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{errors[pack.packId]}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
