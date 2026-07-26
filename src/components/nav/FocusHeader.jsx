import { ChevronLeft } from 'lucide-react';
import { navigateHash } from '../../navigation/useRoute.js';
import { COLORS, F_MONO, F_DISPLAY } from '../../theme.js';

// 集中モード(Play / Setup)のヘッダー。グローバルナビの代わりに
// 「離脱導線 + 現在地」だけを出す。回遊モードとの差はこの1点に限る。
// 画面側のログ等が下に伸びてもタイトルと離脱導線を見失わないよう sticky にする。
// 高さは離脱ボタンの最小タップ域+上下padding+下枠線から算出し、定数として公開する。
// 画面側が自分のスティッキー要素をこの下に追随させる際、実測値とズレて隙間や
// 重なりが生じないようにするため。以下の3定数はスタイルオブジェクト側でも
// そのまま使い、高さの数値とレイアウトが食い違わないようにする。
const EXIT_BUTTON_MIN_HEIGHT = 44; // 離脱ボタンの最小タップ域
const HEADER_VERTICAL_PADDING = 16; // 上下padding合計(8px×2)
const HEADER_BORDER_WIDTH = 1; // 下枠線
export const FOCUS_HEADER_HEIGHT = EXIT_BUTTON_MIN_HEIGHT + HEADER_VERTICAL_PADDING + HEADER_BORDER_WIDTH;

// style は帯そのものの見た目を画面側から微調整するための汎用の逃し口。
// 画面固有の判定(どの画面か、パネルが出ているか等)はここには持ち込まず、
// 値だけを受け取る。padding のような一括指定より後ろに展開しているので、
// paddingRight だけを上書きするような部分指定もそのまま効く。
export default function FocusHeader({ title, steps, currentStep = 0, exitLabel = 'ホーム', onExit, style }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        // 画面側の追随バー(Play context bar, zIndex: 20)を常に上回るようにする。
        // ただしPC/セットアップのオーバーレイパネルとそのスクリムはモーダルとして
        // これより上に来る必要があるため、呼び出し側(Play.jsx等)でさらに上の
        // zIndexを割り当てて重ねる。
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: FOCUS_HEADER_HEIGHT,
        boxSizing: 'border-box',
        padding: `${HEADER_VERTICAL_PADDING / 2}px 16px`,
        borderBottom: `${HEADER_BORDER_WIDTH}px solid ${COLORS.line}`,
        // 下にスクロールするコンテンツが透けないよう不透明にする。
        background: COLORS.card,
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => (onExit ? onExit() : navigateHash('#/'))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minHeight: EXIT_BUTTON_MIN_HEIGHT,
          padding: '0 8px',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: F_MONO,
          fontSize: 12,
          color: COLORS.inkSoft,
          whiteSpace: 'nowrap',
        }}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {exitLabel}
      </button>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: F_DISPLAY,
          fontSize: 16,
          color: COLORS.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>

      {steps && steps.length > 0 && (
        <ol
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            fontFamily: F_MONO,
            fontSize: 11,
          }}
        >
          {steps.map((label, i) => (
            <li key={label}>
              <span
                aria-current={i === currentStep ? 'step' : undefined}
                style={{
                  // 色だけに頼らず太さでも現在地を示す。未到達のステップも読ませる文字なので、
                  // コントラストが AA に届かない faint ではなく brassDark にする。
                  color: i === currentStep ? COLORS.ink : COLORS.brassDark,
                  fontWeight: i === currentStep ? 600 : 400,
                }}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
