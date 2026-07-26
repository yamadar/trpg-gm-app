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
  // バナーはシェルの子として全ルートに描かれるため、出しっぱなしにすると
  // 一度の失敗が以降すべての画面の先頭に居座る。「どのルートで見せたいバナーか」を
  // 値そのものに持たせ、描画時に現在地と突き合わせる。null は「出していない」。
  // 突き合わせだけで描画を抑えるのは、後始末の effect が走るまでの1コミットのあいだ
  // 古いバナーが見えてしまうのを防ぐため。値の破棄はそれとは別に effect が行う
  // (下の routeKey 後始末を参照)。両方が要る: 描画ガードだけだと同じルートへ
  // 戻るたびにバナーが甦り、破棄だけだと離脱直後に一瞬ちらつく。
  const [sessionError, setSessionError] = useState(null); // { routeKey, message } | null
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [authError, setAuthError] = useState(null); // { routeKey } | null
  const [uploadingSessions, setUploadingSessions] = useState(false);
  // ウィザードへ引き継ぐ文脈。world.summary や scenario オブジェクトを含み URL には載せられないため、
  // 従来どおりメモリで持つ。#/setup を直接開いた場合は素のウィザードとして開く。
  const [campaignContext, setCampaignContext] = useState(null);
  const [starterContext, setStarterContext] = useState(null);
  const takeover = useSessionTakeover();

  // 直前のルート。プレイ画面から離れたことを検知するために持つ。
  const prevRouteRef = useRef(route);

  useEffect(() => {
    (async () => {
      setStorageOk(await isStorageAvailable());
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === '1') {
      setAuthError({ routeKey });
      params.delete('auth_error');
      const qs = params.toString();
      // hash が現在地の唯一の情報源なので、クエリを畳むついでに落としてはいけない。
      // replaceState は hashchange を発火しないため、落とすと画面はそのままで
      // URL だけ現在地を失い、リロードで別の場所へ着地する。
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
      );
    }
  }, []);

  // ホームへ戻るたびに一覧を取り直す(プレイ後の更新を反映するため)。
  // 初回の取得もここが担う。マウント時にも取っていたころは、ホームで開くと
  // 二重に走り、#/play を直接開いた場合は使わない一覧を取りに行っていた。
  useEffect(() => {
    if (route.name !== 'home') return;
    let cancelled = false;
    (async () => {
      const list = await listSessions();
      if (cancelled) return;
      setSessions(list);
      setLoadingHome(false);
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
        // 見せたいのは差し替えた先のホームなので、バナーにもその routeKey を持たせる。
        setSessionError({ routeKey: buildHash({ name: 'home' }), message: 'セッションが見つかりません' });
        replace({ name: 'home' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name, route.sessionId, session]);

  // ルートが変わったときの後始末。離れたプレイ画面のセッションと、
  // 現在地から外れたバナーを捨てる。
  // 依存は routeKey だけにして、route オブジェクトの作り直しでは走らないようにする。
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = route;

    // バナーは「出したルートで一度だけ」。描画は routeKey の突き合わせで抑えているが、
    // 値を残したままだと同じルートへ戻ってきたときに、新しい失敗が何も起きていないのに
    // また現れてしまう。現在地が離れた時点で値そのものを捨て、二度と甦らせない。
    // 関数更新にしているのは、この effect の依存を routeKey だけに保つため。
    setSessionError((e) => (e && e.routeKey !== routeKey ? null : e));
    setAuthError((e) => (e && e.routeKey !== routeKey ? null : e));

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
        {authError?.routeKey === routeKey && (
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
        {sessionError?.routeKey === routeKey && (
          <div
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              color: COLORS.stamp,
              textAlign: 'center',
              padding: '8px 12px',
            }}
          >
            {sessionError.message}
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
