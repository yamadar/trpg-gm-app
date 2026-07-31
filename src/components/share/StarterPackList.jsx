import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { RULESETS } from '../../data/rulesets.js';
import { listStarters, importStarterPack } from '../../api/starterClient.js';
import { useAuth } from '../../auth/AuthContext.jsx';

function rulesetLabel(id) {
  return RULESETS.find((r) => r.id === id)?.label ?? id;
}

export default function StarterPackList({ onImported }) {
  // ギャラリーはログイン無しで閲覧できる設計だが、取り込み先のAPIは認証必須。
  // 未ログインのまま押させて401を踏ませるより、ここで先にボタンを隠す
  // (PublicItemDetailと同じ判断・同じ認証情報源)
  const { user } = useAuth();
  const [packs, setPacks] = useState([]);
  // 複数カードを並行して操作できるので、busy/errors はどちらも packId をキーにした
  // オブジェクトで持つ(単一スカラーだと他カードの操作でこのカードの状態が上書きされる)。
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  // アンマウント後の setState を防ぐ。onImported で親が画面遷移し、start() の
  // 完了待ちの間にこのコンポーネントごと外れるケースがあるため。
  // 守るのは自分の state だけ。取り込みの結果そのもの(onImported)は、この一覧が
  // 残っているかどうかとは無関係に親へ渡さなければならない(下の start() を参照)。
  const aliveRef = useRef(true);

  useEffect(() => {
    let alive = true;
    // マウントのたびに立て直す。ref はインスタンスに紐づくため、初期値だけに頼ると
    // 一度クリーンアップが走った後(StrictModeの二重呼び出し等)に false のまま戻らない。
    aliveRef.current = true;
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
    let result;
    try {
      result = await importStarterPack(pack.packId);
    } catch (e) {
      if (aliveRef.current) {
        setErrors((prev) => ({ ...prev, [pack.packId]: '取り込みに失敗した: ' + e.message }));
      }
      return;
    } finally {
      if (aliveRef.current) {
        setBusy((prev) => ({ ...prev, [pack.packId]: false }));
      }
    }
    // アンマウント済みでも必ず渡す。素材はサーバー側に出来上がっているので、ここで
    // 打ち切ると「取り込みだけ済んで画面はどこへも行かない」状態になる。
    // 渡した先(App)が触るのは親のstateだけなので、この一覧の生死とは無関係に安全。
    onImported?.({
      world: result.world,
      scenario: result.scenario,
      rulesetId: result.scenario?.recommendedRuleset ?? pack.recommendedRuleset,
    });
  }

  if (packs.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 未ログイン時の案内はカードごとではなく一覧の先頭に1回だけ出す。
          以前はカード内に置いていたため、7件並ぶと同じ文が7回読み上げられていた。 */}
      {!user && (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
          取り込みにはログインが必要です(右上からログイン)
        </div>
      )}
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
            <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
              {pack.scenarioCount > 1 ? `全${pack.scenarioCount}話 / ${pack.scenarioTitle}` : pack.scenarioTitle}
            </span>
          </div>

          {pack.source && (
            <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 8 }}>{pack.source}</div>
          )}

          {user && (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="brass"
                onClick={() => start(pack)}
                disabled={!!busy[pack.packId]}
                // 同じラベルのボタンが縦に並ぶため、どの冒険を始めるのかを名前に含める。
                aria-label={`${pack.title} の冒険を始める`}
              >
                {busy[pack.packId] ? '取り込み中…' : 'この冒険を始める'}
              </Button>
            </div>
          )}

          {errors[pack.packId] && (
            <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{errors[pack.packId]}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
