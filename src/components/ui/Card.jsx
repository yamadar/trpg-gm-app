import { COLORS } from '../../theme.js';

// onClick は「カードのどこを押しても反応する」ためのマウス向け補助であり、これ単体では
// キーボードから到達できない。押せるカードを作るときは className="card-actionable" を
// 付け、中のタイトルを .card-primary-action の <button> にすること(styles.css 参照)。
export default function Card({ children, style, onClick, className }) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        boxShadow: '0 1px 0 rgba(31,42,56,0.06)',
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
