import { ChevronRight } from 'lucide-react';
import { crumbsFor, wantsDynamicCrumb } from '../../navigation/routes.js';
import { navigateHash } from '../../navigation/useRoute.js';
import { useBreadcrumbTail } from '../../navigation/BreadcrumbContext.jsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { COLORS, F_MONO } from '../../theme.js';

// スマホで表示する末尾の段数。先頭側は DOM に残したまま非表示にする。
const NARROW_VISIBLE = 2;

export default function Breadcrumb({ route }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const tail = useBreadcrumbTail();

  const crumbs = [...crumbsFor(route)];
  // 動的ラベルが未登録の間は段を足さない(IDを露出させないため)。
  if (wantsDynamicCrumb(route) && tail) {
    crumbs.push({ key: 'dynamic', label: tail, hash: null });
  }

  const firstVisible = wide ? 0 : Math.max(0, crumbs.length - NARROW_VISIBLE);

  return (
    <nav
      aria-label="現在地"
      // ラベル到着でレイアウトが跳ねないよう高さを固定する。
      style={{ minHeight: 32, display: 'flex', alignItems: 'center' }}
    >
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          listStyle: 'none',
          margin: 0,
          padding: 0,
          fontFamily: F_MONO,
          fontSize: 12,
        }}
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li
              key={crumb.key}
              style={{
                display: i < firstVisible ? 'none' : 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 0,
              }}
            >
              {i > 0 && <ChevronRight size={12} color={COLORS.faint} aria-hidden="true" />}
              {isLast ? (
                <span
                  aria-current="page"
                  style={{
                    color: COLORS.ink,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 240,
                  }}
                >
                  {crumb.label}
                </span>
              ) : (
                <button
                  onClick={() => navigateHash(crumb.hash)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px 2px',
                    cursor: 'pointer',
                    fontFamily: F_MONO,
                    fontSize: 12,
                    color: COLORS.faint,
                    textDecoration: 'underline',
                  }}
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
