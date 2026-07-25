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
import { useHashRoute, clearHash } from './router/useHashRoute.js';
import { AuthProvider } from './auth/AuthContext.jsx';
import { useSessionTakeover } from './auth/useSessionTakeover.js';
import AuthBar from './components/auth/AuthBar.jsx';
import ConfirmModal from './components/library/ConfirmModal.jsx';

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  useGoogleFonts();
  const [view, setView] = useState('home'); // home | setup | library | gallery | play
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [uploadingSessions, setUploadingSessions] = useState(false);
  const [campaignContext, setCampaignContext] = useState(null);
  const takeover = useSessionTakeover();
  const { userId: routeUserId, endings: routeEndings, achievements: routeAchievements } = useHashRoute();

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

  async function handleContinue(id) {
    const s = await getSession(id);
    if (s) {
      setSession(s);
      setView('play');
    }
  }

  async function handleStart(newSession) {
    setSession(newSession);
    await saveSession(newSession);
    setView('play');
  }

  async function handleExit() {
    setSessions(await listSessions());
    setSession(null);
    setView('home');
  }

  if (routeUserId) {
    return (
      <div
        style={{
          background: COLORS.paper,
          minHeight: '100vh',
          color: COLORS.ink,
        }}
      >
        <AuthBar />
        <UserPage userId={routeUserId} />
      </div>
    );
  }

  if (routeEndings) {
    return (
      <div
        style={{
          background: COLORS.paper,
          minHeight: '100vh',
          color: COLORS.ink,
        }}
      >
        <AuthBar />
        <EndingGallery onClose={clearHash} />
      </div>
    );
  }

  if (routeAchievements) {
    return (
      <div
        style={{
          background: COLORS.paper,
          minHeight: '100vh',
          color: COLORS.ink,
        }}
      >
        <AuthBar />
        <AchievementList onClose={clearHash} />
      </div>
    );
  }

  return (
    <div
      style={{
        background: COLORS.paper,
        minHeight: '100vh',
        color: COLORS.ink,
      }}
    >
      <AuthBar />
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
      {view === 'home' &&
        (loadingHome ? (
          <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
        ) : (
          <Home
            sessions={sessions}
            storageOk={storageOk}
            onNew={() => setView('setup')}
            onContinue={handleContinue}
            onOpenLibrary={() => setView('library')}
            onOpenGallery={() => setView('gallery')}
            onNextChapter={(ctx) => {
              setCampaignContext(ctx);
              setView('setup');
            }}
          />
        ))}
      {view === 'setup' && (
        <Setup
          onStart={(s) => {
            setCampaignContext(null);
            handleStart(s);
          }}
          onCancel={() => {
            setCampaignContext(null);
            setView('home');
          }}
          campaignContext={campaignContext}
        />
      )}
      {view === 'library' && <Library onClose={() => setView('home')} />}
      {view === 'gallery' && <Gallery onClose={() => setView('home')} />}
      {view === 'play' && session && (
        <Play session={session} setSession={setSession} onExit={handleExit} />
      )}
    </div>
  );
}
