import { useEffect, useId, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// モーダルの共通土台。以前は ConfirmModal / LoginModal がそれぞれ素の <div> を
// 重ねるだけで、role も aria-modal もフォーカス管理も無かった。支援技術からは
// ただの div の重なりに見え、Tab は背後のページへ抜け、Esc も効かなかった
// (WCAG 2.1.2 / 2.4.3 / 4.1.2)。
//
// ここで面倒を見るのは4点:
//   1. role="dialog" + aria-modal + アクセシブル名(見出し or aria-label)
//   2. 開いたときに中へフォーカスを入れる
//   3. Tab / Shift+Tab をダイアログ内で循環させる(フォーカストラップ)
//   4. Esc で閉じ、閉じたら元いた要素へフォーカスを戻す
export default function Modal({ open, onClose, title, titleStyle, label, zIndex = 100, children, panelStyle }) {
  const panelRef = useRef(null);
  // 開く直前にフォーカスがあった要素。閉じたときにここへ戻す。
  const restoreRef = useRef(null);
  const id = useId();
  const titleId = `${id}-title`;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;

    const panel = panelRef.current;
    // パネル内の最初の操作要素へ。無ければパネル自身(tabIndex=-1)へ入れる。
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      // 可視判定に offsetParent は使えない。position:fixed の子孫では常に null に
      // なるため(このパネル自体が fixed の中にある)、全要素が「不可視」と判定されて
      // トラップが1要素に潰れる。hidden 属性だけを見る。
      const items = [...(panel?.querySelectorAll(FOCUSABLE) || [])].filter(
        (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true'
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // フォーカスを戻す。閉じるボタンが消えた後に body へ落ちるのを防ぐ。
      const target = restoreRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // 背景クリックで閉じるのはマウス向けの利便。キーボードには Esc がある。
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31,42,56,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        {title && (
          <h2 id={titleId} style={titleStyle}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
