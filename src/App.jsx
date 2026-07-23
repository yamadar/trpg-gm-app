import { useState, useEffect } from 'react';
import { useGoogleFonts, COLORS, F_MONO } from './theme.js';
import { listSessions, getSession, saveSession, isStorageAvailable } from './storage/index.js';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Play from './screens/Play.jsx';
import Library from './screens/Library.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import AuthBar from './components/auth/AuthBar.jsx';

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  useGoogleFonts();
  const [view, setView] = useState('home'); // home | setup | library | play
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [authError, setAuthError] = useState(false);

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

  return (
    <div
      style={{
        background: COLORS.paper,
        minHeight: '100vh',
        color: COLORS.ink,
      }}
    >
      <AuthBar />
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
          />
        ))}
      {view === 'setup' && <Setup onStart={handleStart} onCancel={() => setView('home')} />}
      {view === 'library' && <Library onClose={() => setView('home')} />}
      {view === 'play' && session && (
        <Play session={session} setSession={setSession} onExit={handleExit} />
      )}
    </div>
  );
}
