import { useState, useEffect } from 'react';
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
        setSessionError('セッションが見つかりません');
        replace({ name: 'home' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name, route.sessionId, session]);

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
              // 「+ 新規プレイ」から入ったSetupが直前のスターター選択を引きずると、
              // World/Scenarioが勝手に選択済みになる
              onNew={() => {
                setStarterContext(null);
                setCampaignContext(null);
                navigate({ name: 'setup' });
              }}
              onContinue={(id) => navigate({ name: 'play', sessionId: id })}
              onNextChapter={(ctx) => {
                setCampaignContext(ctx);
                navigate({ name: 'setup' });
              }}
              onStartStarter={(ctx) => {
                setStarterContext(ctx);
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
              navigate({ name: 'setup' });
            }}
          />
        )}
        {route.name === 'records' && route.recordsTab === 'endings' && <EndingGallery />}
        {route.name === 'records' && route.recordsTab === 'achievements' && <AchievementList />}
        {route.name === 'user' && <UserPage userId={route.userId} />}
        {route.name === 'play' && session && session.id === route.sessionId && (
          <Play session={session} setSession={setSession} />
        )}
      </AppShell>
    </div>
  );
}
