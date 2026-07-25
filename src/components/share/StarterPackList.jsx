import { useState, useEffect } from 'react';
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
  const [busy, setBusy] = useState(null); // インポート中の packId
  const [errors, setErrors] = useState({}); // packId -> メッセージ

  useEffect(() => {
    let alive = true;
    listStarters()
      .then((m) => alive && setPacks(m?.packs ?? []))
      // 取得できないことは「まだ無い」と同じ扱いにする。ここでエラーを出すと、
      // スターター未シードの環境で Home / Gallery に無関係な赤字が出続ける。
      .catch(() => alive && setPacks([]))
      .finally(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function start(pack) {
    setBusy(pack.packId);
    setErrors((prev) => ({ ...prev, [pack.packId]: '' }));
    try {
      const result = await importStarterPack(pack.packId);
      onImported({
        world: result.world,
        scenario: result.scenario,
        rulesetId: pack.recommendedRuleset,
      });
    } catch (e) {
      setErrors((prev) => ({ ...prev, [pack.packId]: '取り込みに失敗した: ' + e.message }));
    } finally {
      setBusy(null);
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
            {(pack.moods ?? []).map((m) => (
              <Badge key={m}>{m}</Badge>
            ))}
            <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>{pack.scenarioTitle}</span>
          </div>

          {pack.source && (
            <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 8 }}>{pack.source}</div>
          )}

          <div style={{ marginTop: 12 }}>
            <Button variant="brass" onClick={() => start(pack)} disabled={busy === pack.packId}>
              {busy === pack.packId ? '取り込み中…' : 'この冒険を始める'}
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
