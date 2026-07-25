import { COLORS } from '../../theme.js';

export default function AchievementProgressBar({ current, target, label, width }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  // role属性はspanが背負い、trackとfillの2段のdivで見た目を作る。役割保持要素をdivに
  // してしまうとテストの `container.querySelector('div > div')` が(RTLのcontainer自体が
  // divのため)trackを拾ってしまい、割合を持つfillまで届かない。
  return (
    <span role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={target} aria-label={label}>
      <div style={{ height: 4, borderRadius: 999, background: COLORS.paperDark, overflow: 'hidden', width }}>
        <div style={{ height: '100%', width: `${pct}%`, background: COLORS.brass }} />
      </div>
    </span>
  );
}
