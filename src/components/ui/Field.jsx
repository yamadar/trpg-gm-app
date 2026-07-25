import { Children, cloneElement, isValidElement, useId } from 'react';
import { COLORS, F_DISPLAY, F_BODY } from '../../theme.js';

const labelStyle = {
  display: 'block',
  fontFamily: F_DISPLAY,
  fontSize: 13,
  color: COLORS.brassDark,
  marginBottom: 6,
  letterSpacing: 0.5,
};

const hintStyle = {
  fontFamily: F_BODY,
  fontSize: 12,
  color: COLORS.faint,
  marginBottom: 6,
};

// ラベルは以前 <div> で描画されており、入力欄と全く関連付いていなかった。
// スクリーンリーダーは「編集テキスト」としか読まず、何を入れる欄なのか分からない
// (WCAG 1.3.1 / 3.3.2)。
//
// 子が単一のホスト要素(input/textarea/select 等)のときは、useId で採番した id を
// 子へ渡して <label htmlFor> で明示的に結び付ける。hint があれば aria-describedby
// で補足として読ませる。
//
// 子が複数、あるいは対象が一意に定まらないとき(MoodChips のようなコントロール群や
// ラッパーコンポーネント)は htmlFor の相手がいないので <label> は使えない。
// role="group" + aria-labelledby でまとめてラベル付けする。
export default function Field({ label, hint, children }) {
  const id = useId();
  const controlId = `${id}-control`;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;

  const childArray = Children.toArray(children);
  const only = childArray.length === 1 && isValidElement(childArray[0]) ? childArray[0] : null;
  // typeof type === 'string' は「素のDOM要素」の判定。独自コンポーネントに id を
  // 渡しても入力欄に届く保証がないため、その場合は group 側に倒す。
  const canLabel = only !== null && typeof only.type === 'string';

  const hintNode = hint ? (
    <div id={hintId} style={hintStyle}>
      {hint}
    </div>
  ) : null;

  if (canLabel) {
    // 呼び出し側が既に id を振っている場合はそちらを尊重する。
    const targetId = only.props.id || controlId;
    const describedBy = [only.props['aria-describedby'], hint ? hintId : null].filter(Boolean).join(' ');
    return (
      <div style={{ marginBottom: 18 }}>
        <label htmlFor={targetId} style={labelStyle}>
          {label}
        </label>
        {hintNode}
        {cloneElement(only, {
          id: targetId,
          'aria-describedby': describedBy || undefined,
        })}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div id={labelId} style={labelStyle}>
        {label}
      </div>
      {hintNode}
      <div role="group" aria-labelledby={labelId} aria-describedby={hint ? hintId : undefined}>
        {children}
      </div>
    </div>
  );
}
