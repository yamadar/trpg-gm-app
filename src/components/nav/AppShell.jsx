import { navTabFor, isFocusRoute } from '../../navigation/routes.js';
import { navigateHash } from '../../navigation/useRoute.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import GlobalNav from './GlobalNav.jsx';
import Breadcrumb from './Breadcrumb.jsx';
import AccountMenu from './AccountMenu.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { COLORS, F_DISPLAY } from '../../theme.js';

// 集中モードではスマホの下部タブバーが無いので余白も要らない。
// 下部固定バーの実高さは「中身 + GlobalNav の上下padding」で決まり、その下側は
// max(4px, env(safe-area-inset-bottom)) なのでホームインジケータのある端末では
// 4px ではなく 34px 前後になる。固定値で見積もると末尾のコンテンツがバーに隠れるため、
// safe-area の分を calc() で実行時に足す(GlobalNav 側の padding 指定と対で維持すること)。
// なお env() を解釈できないUAはこの宣言ごと落とすため、余白が0になり末尾の
// コンテンツが固定バーの裏に隠れる。CSSなら固定値の宣言を先に書いて二段構えに
// できるが、インラインstyleオブジェクトは同じプロパティを2回持てないので表現できない。
// このアプリの対応ブラウザは全て env() を解釈するため、フォールバックは置かない。
// 対応範囲を広げるときは、ここをCSSクラスへ出して二段構えに戻すこと。
const NARROW_TABBAR_BASE = 64;
const NARROW_TABBAR_SPACE = `calc(${NARROW_TABBAR_BASE}px + max(0px, env(safe-area-inset-bottom) - 4px))`;

export default function AppShell({ route, children }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const focus = isFocusRoute(route);

  // 集中モード(Play / Setup)はヘッダーを画面側の FocusHeader に任せ、シェルは何も出さない。
  if (focus) {
    return (
      <main id="main">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    );
  }

  return (
    <>
      <a
        href="#main"
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          background: COLORS.card,
          color: COLORS.ink,
          padding: 8,
          zIndex: 200,
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = '8px';
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
        }}
      >
        本文へスキップ
      </a>

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 90,
          background: COLORS.card,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '6px 16px',
            maxWidth: 1080,
            margin: '0 auto',
          }}
        >
          <button
            onClick={() => navigateHash('#/')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: F_DISPLAY,
              fontSize: 16,
              letterSpacing: 1,
              color: COLORS.ink,
              padding: '8px 0',
              whiteSpace: 'nowrap',
            }}
          >
            GM's Desk
          </button>
          {/* スマホでは下部タブバーになるため、ヘッダー内のナビは幅が広いときだけ挟む */}
          {wide && <GlobalNav activeTab={navTabFor(route)} />}
          <div style={{ flex: 1 }} />
          <AccountMenu />
        </div>

        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 16px 6px' }}>
          <Breadcrumb route={route} />
        </div>
      </header>

      <main id="main" style={{ paddingBottom: wide ? 0 : NARROW_TABBAR_SPACE }}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* 幅が狭いときは下部固定のタブバーとして描く */}
      {!wide && <GlobalNav activeTab={navTabFor(route)} />}
    </>
  );
}
