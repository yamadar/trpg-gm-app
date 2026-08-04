import { useState, useEffect, useRef } from 'react';
import { useGoogleFonts, COLORS, F_MONO } from './theme.js';
import { listSessions, getSession, saveSession, removeSession, isStorageAvailable } from './storage/index.js';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Play from './screens/Play.jsx';
import PartySetup from './screens/PartySetup.jsx';
import PartyPlay from './screens/PartyPlay.jsx';
import PartyJoin from './screens/PartyJoin.jsx';
import Library from './screens/Library.jsx';
import Gallery from './screens/Gallery.jsx';
import UserPage from './screens/UserPage.jsx';
import EndingGallery from './screens/EndingGallery.jsx';
import AchievementList from './screens/AchievementList.jsx';
import { useRoute, navigate, replace } from './navigation/useRoute.js';
import { buildHash } from './navigation/routes.js';
import { BreadcrumbProvider } from './navigation/BreadcrumbContext.jsx';
import AppShell from './components/nav/AppShell.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { useSessionTakeover } from './auth/useSessionTakeover.js';
import ConfirmModal from './components/library/ConfirmModal.jsx';
import SessionConflictModal from './components/play/SessionConflictModal.jsx';
import MaintenanceBanner from './components/MaintenanceBanner.jsx';
import { getConfig } from './api/sceneImageClient.js';
import { MAINTENANCE_MODE_EVENT } from './api/apiFetch.js';
import {
  getServerSession,
  deleteServerSession,
  forgetSessionSync,
  listServerSessions,
  putSessionToServer,
  rememberSessionSync,
  SESSION_CONFLICT_EVENT,
} from './api/sessionSyncClient.js';
import { reconcileServerSessions } from './api/sessionReconcile.js';
import { listPartySessions } from './api/partyClient.js';

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
  const { user, loading: authLoading } = useAuth();
  const route = useRoute();
  // route オブジェクトは hash が動くたびに作り直されるため、同一性の判定には正準 hash を使う。
  const routeKey = buildHash(route);
  const [sessions, setSessions] = useState([]);
  const [partySessions, setPartySessions] = useState([]);
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
  const [syncConflict, setSyncConflict] = useState(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const [maintenanceMode, setMaintenanceMode] = useState('off');
  // ウィザードへ引き継ぐ文脈。world.summary や scenario オブジェクトを含み URL には載せられないため、
  // 従来どおりメモリで持つ。#/setup を直接開いた場合は素のウィザードとして開く。
  //
  // seq は「ウィザードを開いた回数」。<Setup> の key に使い、文脈が変わったら必ず開き直させる。
  // Setup は文脈をマウント時の初期stateとしてしか読まないため、これが無いと
  // 「既に #/setup にいるところへ文脈が届く」場合に取りこぼす。本番のように取り込みが
  // 遅いと、待ちきれずに「+ 新規プレイ」で先へ進んだ後に取り込みが完了する、という
  // 順序が普通に起きる。そのとき navigate は hash が既に #/setup なので何もせず、
  // ウィザードは0段目(Worldの用意方法/空欄のまま進める)のまま取り残されていた。
  const [wizard, setWizard] = useState({ seq: 0, campaignContext: null, starterContext: null });
  // Homeの「次話を作る」からCampaign制作画面へ渡す選択状態。
  // reconciliation対象sessionIdもURLへ載せず、CampaignTabが章精算を開くために使う。
  const [campaignFocus, setCampaignFocus] = useState(null);
  const [partyWizard, setPartyWizard] = useState({ seq: 0, context: null });
  const takeover = useSessionTakeover();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getConfig()
        .then((config) => {
          if (!cancelled) {
            setMaintenanceMode(config?.maintenanceMode === 'read-only' ? 'read-only' : 'off');
          }
        })
        // 設定取得だけ失敗した場合は通常画面を維持する。書き込みが実際に503を受けたら
        // apiFetchのイベントで即座にread-only表示へ切り替わる。
        .catch(() => {});
    };
    const onMaintenanceMode = (event) => {
      if (event.detail?.mode === 'read-only') setMaintenanceMode('read-only');
    };

    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener(MAINTENANCE_MODE_EVENT, onMaintenanceMode);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(MAINTENANCE_MODE_EVENT, onMaintenanceMode);
    };
  }, []);

  useEffect(() => {
    function onConflict(event) {
      if (!event.detail?.local || !event.detail?.remote) return;
      // 複数の投げっぱなしPUTが同じ409を受けても、先頭の競合を解決するまで
      // ダイアログ内容を差し替えない。
      setSyncConflict((current) => current || event.detail);
      setConflictError('');
    }
    window.addEventListener(SESSION_CONFLICT_EVENT, onConflict);
    return () => window.removeEventListener(SESSION_CONFLICT_EVENT, onConflict);
  }, []);

  // ウィザードの入口は「自分が使う文脈」だけでなく「使わない文脈」も必ず落とす。
  // 離脱経路(ブラウザバック等)は文脈を消さないため、両方が同居すると
  // Setupがstarter基準でPCステップから開き、シナリオだけ無関係なものが
  // 選ばれたまま気づかれずに進んでしまう。
  function openWizard(context) {
    setCampaignFocus(null);
    setWizard((prev) => ({ seq: prev.seq + 1, campaignContext: null, starterContext: null, ...context }));
    navigate({ name: 'setup' });
  }

  function openPartyWizard(context = null) {
    setPartyWizard((current) => ({ seq: current.seq + 1, context }));
    navigate({ name: 'partySetup' });
  }

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
    if (user && !takeover.ready) return;
    let cancelled = false;
    let loading = false;
    async function refreshHomeSessions() {
      if (loading) return;
      loading = true;
      let list = await listSessions();
      if (!user && !cancelled) setPartySessions([]);
      if (user) {
        const [remoteResult, partyResult] = await Promise.allSettled([
          listServerSessions(),
          listPartySessions(),
        ]);
        if (partyResult.status === 'fulfilled') {
          const parties = partyResult.value;
          if (!cancelled) setPartySessions(parties);
        } else {
          console.error('background party session sync failed', partyResult.reason);
        }
        if (remoteResult.status === 'fulfilled') {
          try {
            const remote = remoteResult.value;
            const { pulledIds } = await reconcileServerSessions(list, remote);
            if (pulledIds.length > 0) list = await listSessions();
          } catch (e) {
            console.error('background session reconciliation failed', e);
          }
        } else {
          console.error('background session sync failed', remoteResult.reason);
        }
      }
      if (cancelled) return;
      setSessions(list);
      setLoadingHome(false);
      loading = false;
    }
    refreshHomeSessions();
    const timer = user ? setInterval(refreshHomeSessions, 15_000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [route.name, user?.id, takeover.ready, takeover.syncVersion]);

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
        return;
      }
      // 別端末で作ったセッションはIndexedDBにまだ無い。認証解決後にサーバーを
      // フォールバック参照し、この端末へ保存してから開く。
      if (authLoading) return;
      if (user) {
        try {
          const remote = await getServerSession(route.sessionId);
          if (cancelled) return;
          if (await saveSession(remote)) {
            rememberSessionSync(remote);
            if (!cancelled) setSession(remote);
          } else {
            throw new Error('この端末への保存に失敗した');
          }
          return;
        } catch (e) {
          if (e.status !== 404) console.error('server session load failed', e);
        }
      }
      // 見せたいのは差し替えた先のホームなので、バナーにもその routeKey を持たせる。
      setSessionError({ routeKey: buildHash({ name: 'home' }), message: 'セッションが見つかりません' });
      replace({ name: 'home' });
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name, route.sessionId, session, user?.id, authLoading]);

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
    if (user) {
      try {
        // セッション作成直後から他端末一覧へ出し、Playマウント時の在席通知も
        // 404にならない状態を作る。回線断ならローカル保存済み内容で開始を続ける。
        await putSessionToServer(newSession);
      } catch (e) {
        console.error('initial session sync failed', e);
      }
    }
    // 使い切った文脈は捨てる。seq は上げない(ウィザードはこの後アンマウントされる)。
    setWizard((prev) => ({ ...prev, campaignContext: null, starterContext: null }));
    navigate({ name: 'play', sessionId: newSession.id });
  }

  async function handleDeleteSession(sessionId) {
    if (user) {
      try {
        await deleteServerSession(sessionId);
      } catch (error) {
        // 別端末で削除済みなら、残ったIndexedDBコピーの削除を続ける。
        if (error.status !== 404) throw error;
      }
    }
    if (!(await removeSession(sessionId))) {
      throw new Error('この端末からセッションを削除できませんでした');
    }
    forgetSessionSync(sessionId);
    setSessions((items) => items.filter((item) => item.id !== sessionId));
    if (session?.id === sessionId) setSession(null);
  }

  async function useRemoteProgress() {
    if (!syncConflict?.remote) return;
    setResolvingConflict(true);
    setConflictError('');
    try {
      const saved = await saveSession(syncConflict.remote);
      if (!saved) throw new Error('この端末への保存に失敗した');
      rememberSessionSync(syncConflict.remote);
      if (session?.id === syncConflict.sessionId) setSession(syncConflict.remote);
      setSessions((items) => {
        const next = items.filter((item) => item.id !== syncConflict.remote.id);
        return [syncConflict.remote, ...next].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      });
      setSyncConflict(null);
    } catch (e) {
      setConflictError(e.message);
    } finally {
      setResolvingConflict(false);
    }
  }

  async function overwriteRemoteProgress() {
    if (!syncConflict?.local) return;
    setResolvingConflict(true);
    setConflictError('');
    try {
      // ダイアログ表示後にもメモリ上で更新が増えていれば、より新しい方を送る。
      const local =
        session?.id === syncConflict.sessionId ? session : syncConflict.local;
      const saved = await putSessionToServer(local, { force: true });
      await saveSession(saved);
      if (session?.id === syncConflict.sessionId) setSession(saved);
      setSessions((items) => {
        const next = items.filter((item) => item.id !== saved.id);
        return [saved, ...next].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      });
      setSyncConflict(null);
    } catch (e) {
      setConflictError(e.message);
    } finally {
      setResolvingConflict(false);
    }
  }

  return (
    <div style={{ background: COLORS.paper, minHeight: '100vh', color: COLORS.ink }}>
      <AppShell route={route}>
        <MaintenanceBanner mode={maintenanceMode} />
        <SessionConflictModal
          conflict={syncConflict}
          busy={resolvingConflict}
          error={conflictError}
          onUseRemote={useRemoteProgress}
          onOverwrite={overwriteRemoteProgress}
        />
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
              partySessions={partySessions}
              storageOk={storageOk}
              onNew={() => openWizard({})}
              onNewParty={() => openPartyWizard(null)}
              onContinueParty={(id) => navigate({ name: 'party', sessionId: id })}
              onNewCampaign={() => {
                setCampaignFocus(null);
                navigate({ name: 'library', libraryTab: 'campaign', worldId: null });
              }}
              onContinue={(id) => navigate({ name: 'play', sessionId: id })}
              onDeleteSession={handleDeleteSession}
              onNextChapter={(focus) => {
                setCampaignFocus(focus);
                navigate({ name: 'library', libraryTab: 'campaign', worldId: focus.worldId });
              }}
              onStartStarter={(ctx) => openWizard({ starterContext: ctx })}
            />
          ))}

        {route.name === 'setup' && (
          <Setup
            key={wizard.seq}
            onStart={handleStart}
            campaignContext={wizard.campaignContext}
            starterContext={wizard.starterContext}
          />
        )}
        {route.name === 'partySetup' && (
          <PartySetup
            key={partyWizard.seq}
            initialContext={partyWizard.context}
            onCreated={(id) => navigate({ name: 'party', sessionId: id })}
          />
        )}
        {route.name === 'partyJoin' && (
          <PartyJoin sessionId={route.sessionId} inviteToken={route.inviteToken} />
        )}
        {route.name === 'party' && <PartyPlay key={route.sessionId} sessionId={route.sessionId} />}
        {route.name === 'library' && (
          <Library
            route={route}
            campaignFocus={campaignFocus}
            onStartCampaignChapter={(ctx) => openWizard({ campaignContext: ctx })}
            onStartPartyChapter={openPartyWizard}
          />
        )}
        {route.name === 'browse' && (
          <Gallery route={route} onStartStarter={(ctx) => openWizard({ starterContext: ctx })} />
        )}
        {route.name === 'records' && route.recordsTab === 'endings' && <EndingGallery />}
        {route.name === 'records' && route.recordsTab === 'achievements' && <AchievementList />}
        {route.name === 'user' && <UserPage route={route} />}
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
