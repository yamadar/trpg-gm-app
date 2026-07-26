import { useState, useEffect, useRef } from 'react';
import { useGoogleFonts, COLORS, F_MONO } from './theme.js';
import { listSessions, getSession, saveSession, isStorageAvailable } from './storage/index.js';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Play from './screens/Play.jsx';
import Library from './screens/Library.jsx';
import Gallery from './screens/Gallery.jsx';
import UserPage from './screens/UserPage.jsx';
import EndingGallery from './screens/EndingGallery.jsx';
import AchievementList from './screens/AchievementList.jsx';
import { useRoute, navigate, replace } from './navigation/useRoute.js';
import { buildHash } from './navigation/routes.js';
import { BreadcrumbProvider } from './navigation/BreadcrumbContext.jsx';
import AppShell from './components/nav/AppShell.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { useSessionTakeover } from './auth/useSessionTakeover.js';
import ConfirmModal from './components/library/ConfirmModal.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BreadcrumbProvider>
        <AppInner />
      </BreadcrumbProvider>
    </AuthProvider>
  );
}

function AppInner() {
  useGoogleFonts();
  const route = useRoute();
  // route オブジェクトは hash が動くたびに作り直されるため、同一性の判定には正準 hash を使う。
  const routeKey = buildHash(route);
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [sessionError, setSessionError] = useState('');
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [uploadingSessions, setUploadingSessions] = useState(false);
  // ウィザードへ引き継ぐ文脈。world.summary や scenario オブジェクトを含み URL には載せられないため、
  // 従来どおりメモリで持つ。#/setup を直接開いた場合は素のウィザードとして開く。
  const [campaignContext, setCampaignContext] = useState(null);
  const [starterContext, setStarterContext] = useState(null);
  const takeover = useSessionTakeover();

  // バナーはシェルの子として全ルートに描かれるため、出しっぱなしにすると
  // 一度の失敗が以降すべての画面の先頭に居座る。「どのルートで見せたいバナーか」を
  // 覚えておき、そこから離れた時点で畳む。null は「出していない」。
  const authErrorRouteRef = useRef(null);
  const sessionErrorRouteRef = useRef(null);
  // 直前のルート。プレイ画面から離れたことを検知するために持つ。
  const prevRouteRef = useRef(route);

  useEffect(() => {
    (async () => {
      setStorageOk(await isStorageAvailable());
      setSessions(await listSessions());
      setLoadingHome(false);
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === '1') {
      authErrorRouteRef.current = routeKey;
      setAuthError(true);
      params.delete('auth_error');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  // ホームへ戻るたびに一覧を取り直す(プレイ後の更新を反映するため)。
  useEffect(() => {
    if (route.name !== 'home') return;
    let cancelled = false;
    (async () => {
      const list = await listSessions();
      if (!cancelled) setSessions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name]);

  // #/play/:sessionId を直接開いた/リロードした場合にセッションを読み直す。
  useEffect(() => {
    if (route.name !== 'play') return;
    if (session && session.id === route.sessionId) return;
    let cancelled = false;
    (async () => {
      const s = await getSession(route.sessionId);
      if (cancelled) return;
      if (s) {
        setSession(s);
      } else {
        // 見せたいのは差し替えた先のホーム。ここで基準を先に置いておかないと、
        // 直後の replace によるルート変更で自分自身のバナーを畳んでしまう。
        sessionErrorRouteRef.current = buildHash({ name: 'home' });
        setSessionError('セッションが見つかりません');
        replace({ name: 'home' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name, route.sessionId, session]);

  // ルートが変わったときの後始末。バナーを畳み、離れたプレイ画面のセッションを捨てる。
  // 依存は routeKey だけにして、route オブジェクトの作り直しでは走らないようにする。
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = route;

    if (authErrorRouteRef.current !== null && authErrorRouteRef.current !== routeKey) {
      authErrorRouteRef.current = null;
      setAuthError(false);
    }
    if (sessionErrorRouteRef.current !== null && sessionErrorRouteRef.current !== routeKey) {
      sessionErrorRouteRef.current = null;
      setSessionError('');
    }

    // メモリ上の session を握ったままだと、素材ライブラリから消したセッションへ
    // 同じ #/play/:id で戻ったときにストレージを読み直さず古い内容を映してしまう。
    // ただし「ウィザード完了 → #/play/:id」では handleStart が置いた session を
    // 捨ててはいけないので、直前がプレイ画面だったときだけ捨てる。
    if (prev.name === 'play' && !(route.name === 'play' && route.sessionId === prev.sessionId)) {
      setSession(null);
    }
  }, [routeKey]);

  async function handleStart(newSession) {
    setSession(newSession);
    await saveSession(newSession);
    setCampaignContext(null);
    setStarterContext(null);
    navigate({ name: 'play', sessionId: newSession.id });
  }

  return (
    <div style={{ background: COLORS.paper, minHeight: '100vh', color: COLORS.ink }}>
      <AppShell route={route}>
        <ConfirmModal
          open={takeover.pendingCount > 0}
          message={`このブラウザに保存されたセッション${takeover.pendingCount}件をアカウントに保存しますか?`}
          confirmLabel="保存する"
          confirmDisabled={uploadingSessions}
          onConfirm={async () => {
            setUploadingSessions(true);
            try {
              await takeover.confirm();
            } finally {
              setUploadingSessions(false);
            }
          }}
          onCancel={takeover.dismiss}
        />
        {authError && (
          <div
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              color: COLORS.stamp,
              textAlign: 'center',
              padding: '8px 12px',
            }}
          >
            ログインに失敗しました。もう一度お試しください。
          </div>
        )}
        {sessionError && (
          <div
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              color: COLORS.stamp,
              textAlign: 'center',
              padding: '8px 12px',
            }}
          >
            {sessionError}
          </div>
        )}

        {route.name === 'home' &&
          (loadingHome ? (
            <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
          ) : (
            <Home
              sessions={sessions}
              storageOk={storageOk}
              // ウィザードの入口は「自分が使う文脈」だけでなく「使わない文脈」も必ず落とす。
              // 離脱経路(ブラウザバック等)は文脈を消さないため、両方が同居すると
              // Setupがstarter基準でPCステップから開き、シナリオだけ無関係なものが
              // 選ばれたまま気づかれずに進んでしまう。
              onNew={() => {
                setStarterContext(null);
                setCampaignContext(null);
                navigate({ name: 'setup' });
              }}
              onContinue={(id) => navigate({ name: 'play', sessionId: id })}
              onNextChapter={(ctx) => {
                setCampaignContext(ctx);
                setStarterContext(null);
                navigate({ name: 'setup' });
              }}
              onStartStarter={(ctx) => {
                setStarterContext(ctx);
                setCampaignContext(null);
                navigate({ name: 'setup' });
              }}
            />
          ))}

        {route.name === 'setup' && (
          <Setup
            onStart={handleStart}
            campaignContext={campaignContext}
            starterContext={starterContext}
          />
        )}
        {route.name === 'library' && <Library route={route} />}
        {route.name === 'browse' && (
          <Gallery
            route={route}
            onStartStarter={(ctx) => {
              setStarterContext(ctx);
              setCampaignContext(null);
              navigate({ name: 'setup' });
            }}
          />
        )}
        {route.name === 'records' && route.recordsTab === 'endings' && <EndingGallery />}
        {route.name === 'records' && route.recordsTab === 'achievements' && <AchievementList />}
        {route.name === 'user' && <UserPage userId={route.userId} />}
        {/* 集中モードのシェルはナビを出さないので、読み込み中に何も描かないと
            真っ白で戻る手段の無い画面になる。ホームと同じ表示で埋める。 */}
        {route.name === 'play' &&
          (session && session.id === route.sessionId ? (
            <Play session={session} setSession={setSession} />
          ) : (
            <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
          ))}
      </AppShell>
    </div>
  );
}
