import { useState, useEffect, useRef, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle, motionAllowed, moodTheme } from '../theme.js';
import { useTypewriter } from '../hooks/useTypewriter.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import CharacterPanel from '../components/play/CharacterPanel.jsx';
import { takeTurn, recallMemory } from '../api/session.js';
import { saveSession } from '../storage/index.js';
import {
  dispatchSessionConflict,
  getDeviceId,
  getServerSession,
  getSessionSyncState,
  heartbeatSession,
  putSessionToServer,
  releaseSessionPresence,
} from '../api/sessionSyncClient.js';
import { normalizeTurnResult } from '../api/turnResult.js';
import { generateSceneImage, sceneImageUrl, getConfig } from '../api/sceneImageClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import FocusHeader, { FOCUS_HEADER_HEIGHT } from '../components/nav/FocusHeader.jsx';
import LoginModal from '../components/auth/LoginModal.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Stamp from '../components/ui/Stamp.jsx';
import Badge from '../components/ui/Badge.jsx';
import RollStatsLine from '../components/ui/RollStatsLine.jsx';
import { recordEnding } from '../api/endingClient.js';
import { summarizeRolls } from '../engine/rollStats.js';

// 画面下端に固定した入力欄(上下padding 16×2 + 枠線 + 入力欄で約76px)が
// ログの末尾に被らないよう確保する高さ。本文カラムの下余白と、ログ末尾を追う
// スクロールの停止位置(scroll-margin-bottom)の双方に同じ値を使い、
// 「入力欄の下に末尾が潜り込む」ことが起きないようにする。
const COMPOSER_RESERVE = 140;
// 未ログイン時は入力欄の上にログイン案内も積む。狭い画面で案内文が2行になっても
// ログ末尾が固定エリアの裏へ隠れない高さを確保する。
const LOGGED_OUT_COMPOSER_RESERVE = 190;

// 自動挿絵を再び発火させるまでに空けるターン数。current_scene はGMが毎ターン自由記述する
// 文字列なので、同じ場面が続いていても言い回しが揺れて「シーン変化」と判定されうる。
// 変化の検出だけに任せると挿絵が毎ターン挟まるため、最低間隔で頻度に上限を掛ける。
const AUTO_ILLUSTRATE_MIN_TURNS = 3;
const PRESENCE_HEARTBEAT_MS = 15_000;
export const SLOW_RESPONSE_NOTICE_MS = 12000;

export default function Play({ session, setSession }) {
  const { user, loading: authLoading } = useAuth();
  const [input, setInput] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slowResponse, setSlowResponse] = useState(false);
  const [error, setError] = useState('');
  const [saveWarning, setSaveWarning] = useState('');
  const [otherDeviceActive, setOtherDeviceActive] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const handleNarrationDone = useCallback(() => setNarrating(false), []);
  const [imageGen, setImageGen] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState(null);
  const [imageError, setImageError] = useState(null); // { index, message } | null
  const [ending, setEnding] = useState(null); // 記録済みのエンディング(この画面で確定した場合のみ)
  const [endingBusy, setEndingBusy] = useState(false);
  const [endingError, setEndingError] = useState('');
  const logEndRef = useRef(null);
  const hasStartedRef = useRef(false);
  // 常に最新のセッションを指すref。非同期処理(挿絵生成・ターン)の完了時に
  // 捕捉した古いセッションで上書きして進行を巻き戻さないよう、完了時点の最新を読む。
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // 直近で自動挿絵を発火したターン。AUTO_ILLUSTRATE_MIN_TURNS の間隔判定に使う。
  const lastAutoIllustrateTurnRef = useRef(null);
  const mood = moodTheme(session.moods);
  const docked = useMediaQuery('(min-width: 1024px)');
  const [panelOpen, setPanelOpen] = useState(false);
  const PANEL_W = 320;
  const composerReserve = !authLoading && !user ? LOGGED_OUT_COMPOSER_RESERVE : COMPOSER_RESERVE;
  // マウント時点のログ長。これ以降に追加されたエントリだけを演出対象にする
  // (セッション再開時に履歴全体が演出され直すのを防ぐ)。
  const initialLogLenRef = useRef(session.log.length);

  // ログ末尾への追従スクロール。
  //
  // block:'nearest' なのは、番兵(logEndRef)が既に見えている間は一切スクロール
  // させないため。既定の 'start' だと番兵を画面最上部へ寄せようとするので、
  // セッション開始直後のようにログが空でも、本文カラムの下余白(COMPOSER_RESERVE)
  // ぶんだけページが下へ送られ、その時点で唯一の表示物である「GMが考えている…」が
  // 画面の外(スティッキーな帯の上)へ追い出されていた。
  // 追従が必要な場合(番兵が画面下の外にある場合)は、番兵の scroll-margin-bottom
  // ぶんだけ手前で止まるので、末尾が固定入力欄の下へ潜り込むこともない。
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [session.log.length, busy]);

  useEffect(() => {
    getConfig()
      .then((c) => setImageGen(!!c.imageGen))
      .catch(() => setImageGen(false));
  }, []);

  // 同じセッションを開いている端末をサーバーへ通知する。ハートビート応答の
  // revisionが進んでいれば本文も取得し、次のPUTを待たずに競合選択を出す。
  useEffect(() => {
    if (!user) {
      setOtherDeviceActive(false);
      return;
    }
    let cancelled = false;
    let checking = false;

    async function checkPresence() {
      if (checking) return;
      checking = true;
      try {
        const presence = await heartbeatSession(session.id);
        if (cancelled) return;
        setOtherDeviceActive(presence.otherDeviceActive === true);

        const knownRevision = getSessionSyncState(sessionRef.current)?.revision ?? 0;
        const remoteRevision = presence.sync?.revision ?? 0;
        if (
          remoteRevision > knownRevision &&
          presence.sync?.updatedByDeviceId &&
          presence.sync.updatedByDeviceId !== getDeviceId()
        ) {
          const remote = await getServerSession(session.id);
          if (!cancelled) dispatchSessionConflict(sessionRef.current, remote, 'remote-update');
        }
      } catch (e) {
        // 新規セッションは導入ターンのPUT完了までサーバー上に存在しない。
        // 404や一時的な回線断でプレイ自体は止めず、次回ハートビートで再試行する。
        if (e.status !== 404) console.error('session presence check failed', e);
      } finally {
        checking = false;
      }
    }

    checkPresence();
    const timer = setInterval(checkPresence, PRESENCE_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      releaseSessionPresence(session.id).catch(() => {});
    };
  }, [user?.id, session.id]);

  // 挿絵生成。baseSession を引数に取り、手動ボタンとシーン変化時の自動生成の双方で再利用する。
  // runTurn より前に定義し、runTurn から参照できるようにする。
  const illustrate = useCallback(
    async (baseSession, i, syncPromise = null) => {
      if (generatingIndex !== null) return;
      setGeneratingIndex(i);
      setImageError(null);
      try {
        // 画像APIはサーバーに保存済みのログで logIndex を検証する。通常のセッション同期は
        // 投げっぱなしなので、ターン直後の自動生成では新しいGMエントリがまだ届いておらず
        // 400 (logIndex must reference a gm log entry) になる。ここで同期の完了を待って、
        // 「サーバーが log[i] を持っている」ことを保証してから要求する。
        // 自動発火時は runTurn が既に開始した PUT の Promise を受け取るので、
        // 同一ペイロードを2回送らずにその完了を待つ。
        await (syncPromise ?? putSessionToServer(baseSession));
        const { imageId, newAppearances } = await generateSceneImage(baseSession.id, i);
        // 生成中に進んだターンを巻き戻さないよう、完了時点の最新セッションへ適用する。
        const current = sessionRef.current;
        const appearances = { ...(current.appearances || {}) };
        for (const a of newAppearances || [])
          appearances[a.name] = { name: a.name, description: a.description, ...(a.imageId ? { imageId: a.imageId } : {}) };
        const updated = {
          ...current,
          log: current.log.map((e, idx) => (idx === i ? { ...e, image: { imageId } } : e)),
          appearances,
          updatedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);
        putSessionToServer(updated).catch((e) => console.error('session server sync failed', e));
      } catch (e) {
        setImageError({ index: i, message: '挿絵の生成に失敗した: ' + e.message });
      } finally {
        setGeneratingIndex(null);
      }
    },
    [generatingIndex, setSession]
  );

  const runTurn = useCallback(
    async (playerText, displayText, { allowRoll = true } = {}) => {
      if (!user) {
        setError('プレイの進行にはログインが必要です。');
        return false;
      }
      setBusy(true);
      setSlowResponse(false);
      setError('');
      const slowResponseTimer = setTimeout(() => setSlowResponse(true), SLOW_RESPONSE_NOTICE_MS);
      try {
        const { result, roll, resourceChange } = await takeTurn(session, playerText, { allowRoll });
        const norm = normalizeTurnResult(result);

        const newFlags = norm.stateUpdate.flags
          ? { ...session.state.flags, ...norm.stateUpdate.flags }
          : session.state.flags;
        const newXp = (Number.isFinite(session.state.xp) ? session.state.xp : 0) + norm.stateUpdate.xpGain;
        // SAN等のリソース副作用。takeTurnは非破壊なので、ここでclamp済みの新値を合成する。
        const newResources = resourceChange
          ? {
              ...(session.state.resources || {}),
              [resourceChange.key]: {
                ...(session.state.resources?.[resourceChange.key] || { max: resourceChange.after }),
                value: resourceChange.after,
              },
            }
          : session.state.resources;
        // 応答待ちの間に挿絵生成が完了して既存エントリへ画像が付いた場合でも失わないよう、
        // ログと素の基底は最新セッションから取る(状態計算はターン開始時のsessionを使う)。
        const latest = sessionRef.current;
        const newLog = [...latest.log];
        if (displayText) newLog.push({ role: 'player', text: displayText });
        newLog.push({ role: 'gm', text: norm.narrative, choices: norm.choices, roll });

        const recent = [...(session.state.recent_log || [])];
        if (displayText) recent.push({ role: 'player', text: displayText });
        recent.push({ role: 'gm', text: norm.narrative });
        while (recent.length > 12) recent.shift(); // 簡易履歴管理。Phase2で要約圧縮に置き換え予定

        const updated = {
          ...latest,
          state: {
            ...session.state,
            current_scene: norm.stateUpdate.current_scene ?? session.state.current_scene,
            flags: newFlags,
            history_summary: norm.stateUpdate.history_summary ?? session.state.history_summary,
            recent_log: recent,
            turn_count: (Number.isFinite(session.state.turn_count) ? session.state.turn_count : 0) + 1,
            xp: newXp,
            tension_level: norm.stateUpdate.tension_level ?? session.state.tension_level ?? 'medium',
            ending_reached: norm.stateUpdate.endingReached,
            ...(newResources ? { resources: newResources } : {}),
          },
          log: newLog,
          updatedAt: Date.now(),
        };
        if (motionAllowed()) setNarrating(true);
        setSession(updated);
        const saved = await saveSession(updated);
        if (!saved) {
          setSaveWarning(
            'セッションの保存に失敗した。ブラウザの保存領域を確認してください(このターンは保存されていない可能性があります)。'
          );
        } else {
          setSaveWarning('');
        }
        const sceneChanged =
          !!norm.stateUpdate.current_scene && norm.stateUpdate.current_scene !== session.state.current_scene;
        const lastAuto = lastAutoIllustrateTurnRef.current;
        const spacedEnough = lastAuto === null || updated.state.turn_count - lastAuto >= AUTO_ILLUSTRATE_MIN_TURNS;
        const shouldAutoIllustrate = imageGen && updated.autoIllustrate && sceneChanged && spacedEnough;

        // PUT は1回だけ発行し、自動挿絵が走る場合はそのPromiseをillustrateへ渡して再利用する。
        const syncPromise = user ? putSessionToServer(updated) : null;
        if (syncPromise && !shouldAutoIllustrate) {
          syncPromise.catch((e) => console.error('session server sync failed', e));
        }

        if (shouldAutoIllustrate) {
          lastAutoIllustrateTurnRef.current = updated.state.turn_count;
          const gmIndex = updated.log.length - 1;
          illustrate(updated, gmIndex, syncPromise);
        }
        return true;
      } catch (e) {
        console.error(e);
        setError('GM応答の取得に失敗した: ' + e.message);
        return false;
      } finally {
        clearTimeout(slowResponseTimer);
        setSlowResponse(false);
        setBusy(false);
      }
    },
    [session, setSession, user, imageGen, illustrate]
  );

  // 導入シーンの取得。未ログイン中は待機し、ログイン後に開始する。
  useEffect(() => {
    if (authLoading || !user) return;
    if (session.log.length === 0 && !hasStartedRef.current) {
      // 印は await の前に付ける(StrictModeの二重呼び出しで導入が2回走らないように)。
      hasStartedRef.current = true;
      // 導入シーンには判定すべきプレイヤーの行動がまだ無い。allowRoll:falseで
      // 判定を閉じないと、中身のない判定が1回発生し、その見出しが場面の先頭に出る。
      runTurn('(セッション開始。導入シーンを描写せよ)', null, { allowRoll: false }).then((ok) => {
        // 失敗した導入を「開始済み」にしたままだと、ログインし直しても回線が戻っても
        // 導入シーンは二度と生成されず、場面も選択肢も無い空のプレイ画面が残る。
        if (!ok) hasStartedRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  async function submitFree() {
    if (!user || authLoading || !input.trim() || busy || narrating) return;
    const text = input.trim();
    setInput('');
    const ok = await runTurn(text, text);
    if (!ok) setInput(text);
  }

  function submitChoice(choice) {
    if (!user || authLoading || busy || narrating) return;
    runTurn(choice, choice);
  }

  // エンディングの確定・取り消しはターン進行を伴わないので、最新セッションへ直接書く。
  // runTurnと同じ保存失敗時の扱い(警告表示)にしないと、ターン中と同じ理由で
  // ローカル保存が失敗した場合に確定/取り消しが無言で消えてしまう。
  async function persistSession(updated) {
    setSession(updated);
    const saved = await saveSession(updated);
    if (!saved) {
      setSaveWarning(
        'セッションの保存に失敗した。ブラウザの保存領域を確認してください(この操作は保存されていない可能性があります)。'
      );
    } else {
      setSaveWarning('');
    }
    // サーバー同期の完了をここで待つ。finishStoryはこの直後にrecordEndingNowを呼ぶが、
    // サーバー側のエンディング記録はストア済みセッションを読んでendedAtの有無を判定するため、
    // PUTが先に届いていないと「session has not ended」で400になり得る
    // (PUTはログ込みの大きいペイロード、POSTは小さく先着し得るため、fire-and-forgetのままでは
    // 到着順が保証されない)。同期失敗はこれまでどおりUIをブロックしない: console.errorのみに留め、
    // 例外は投げない。
    try {
      await putSessionToServer(updated);
    } catch (e) {
      console.error('session server sync failed', e);
    }
  }

  // エンディングの記録。命名はサーバー側でAIが行い、統計はここで集計して送る
  // (サーバーはsrc/をimportできないため、集計ロジックをサーバーへ複製しない)。
  async function recordEndingNow() {
    const current = sessionRef.current;
    setEndingBusy(true);
    setEndingError('');
    try {
      setEnding(await recordEnding(current.id, summarizeRolls(current)));
    } catch (e) {
      setEndingError('エンディングの記録に失敗した: ' + e.message);
    } finally {
      setEndingBusy(false);
    }
  }

  async function finishStory() {
    const current = sessionRef.current;
    // 先に完結を確定させる。記録に失敗しても完結は取り消さない。
    await persistSession({ ...current, endedAt: Date.now(), updatedAt: Date.now() });
    await recordEndingNow();
  }

  // AIの誤検知で完結扱いにしないための逃げ道。次のターンで再度trueが返れば案内は戻る。
  function keepPlaying() {
    const current = sessionRef.current;
    persistSession({
      ...current,
      state: { ...current.state, ending_reached: false },
      updatedAt: Date.now(),
    });
  }

  return (
    <>
      {/* 離脱導線と現在地はFocusHeaderに任せる(集中モード共通)。
          集中モードのヘッダーは Setup と、回遊モードのシェルヘッダーとも同じく
          画面幅いっぱいに敷く。本文カラムの中に入れると、この画面だけ
          帯が中央の720pxで途切れて「画面ごとに上部が変わる」ことになる。
          ドッキング表示ではPCパネルが帯の右320pxに重なるため、本文カラムと同じ
          右余白を帯にも渡す。渡さないと、タイトルは画面幅いっぱいを使えるつもりで
          省略記号を打つので、長いタイトルがパネルの下で語中から断ち切られる。 */}
      <FocusHeader
        title={session.title || 'プレイ中'}
        style={docked ? { paddingRight: PANEL_W + 20 } : undefined}
      />
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: `24px 20px ${composerReserve}px`,
          // ヘッダーが外に出た分、100vhのままだと本文が短くても縦スクロールが出る。
          minHeight: `calc(100vh - ${FOCUS_HEADER_HEIGHT}px)`,
          background: mood.paper,
          ...(docked ? { paddingRight: PANEL_W + 20 } : {}),
        }}
      >
        {/* タイトルと離脱導線はFocusHeaderが持つので、ここは完結バッジとシーン/経験値
            などの文脈情報だけを出す帯にする。ログは下へ伸び続けるので、この帯も
            スクロール位置に依らずFocusHeaderの直下に出す。 */}
        <div
          style={{
            position: 'sticky',
            top: FOCUS_HEADER_HEIGHT,
            zIndex: 20,
            background: mood.paper,
            borderBottom: `1px solid ${COLORS.line}`,
            margin: '0 -20px 16px',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              fontFamily: F_MONO,
              fontSize: 11,
              color: COLORS.faint,
            }}
          >
            {session.endedAt && <Badge variant="brass">完結</Badge>}
            <span>シーン: {session.state.current_scene}</span>
            <span>
              {session.ruleset?.growthUnit || '経験値'}: {session.state.xp || 0}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!docked && (
              <Button variant="ghost" onClick={() => setPanelOpen((v) => !v)} style={{ fontSize: 12, padding: '6px 10px' }}>
                PC
              </Button>
            )}
            {imageGen && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: F_MONO,
                  fontSize: 11,
                  color: COLORS.faint,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!session.autoIllustrate}
                  onChange={(e) => {
                    const updated = { ...session, autoIllustrate: e.target.checked, updatedAt: Date.now() };
                    setSession(updated);
                    saveSession(updated);
                    putSessionToServer(updated).catch((err) => console.error('session server sync failed', err));
                  }}
                />
                挿絵を自動生成
              </label>
            )}
          </div>
        </div>

        {otherDeviceActive && (
          <div
            role="alert"
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              lineHeight: 1.6,
              color: COLORS.stamp,
              border: `1px solid ${COLORS.stamp}`,
              borderRadius: 4,
              padding: '10px 12px',
              marginBottom: 16,
            }}
          >
            別端末で同じセッションをプレイ中。進捗が競合した場合、上書き前に確認が表示される。
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {session.log.map((entry, i) =>
            entry.role === 'player' ? (
              <div
                key={i}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '80%',
                  fontFamily: F_MONO,
                  fontSize: 13,
                  color: COLORS.paper,
                  background: COLORS.ink,
                  borderRadius: 4,
                  padding: '8px 12px',
                }}
              >
                {entry.text}
              </div>
            ) : (
              <Card key={i}>
                {entry.image?.imageId && (
                  <img
                    src={sceneImageUrl(session.id, entry.image.imageId)}
                    alt="場面の挿絵"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: '100%',
                      borderRadius: 6,
                      border: `1px solid ${COLORS.line}`,
                      marginBottom: 10,
                    }}
                  />
                )}
                {imageGen && !entry.image?.imageId && (
                  <div style={{ marginBottom: 8 }}>
                    {generatingIndex === i ? (
                      <span style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>挿絵を描いています…</span>
                    ) : (
                      <Button variant="ghost" onClick={() => illustrate(session, i)} disabled={generatingIndex !== null}>
                        この場面を描く
                      </Button>
                    )}
                    {imageError && imageError.index === i && (
                      <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 4 }}>{imageError.message}</div>
                    )}
                  </div>
                )}
                <Stamp roll={entry.roll} animate={i >= initialLogLenRef.current} />
                <GmNarrative
                  text={entry.text}
                  animate={i >= initialLogLenRef.current && i === session.log.length - 1 && narrating}
                  speedMs={TYPE_SPEED[session.state.tension_level] ?? TYPE_SPEED.medium}
                  onDone={i === session.log.length - 1 ? handleNarrationDone : undefined}
                />
                {i === session.log.length - 1 && !narrating && entry.choices?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    {entry.choices.map((c, ci) => (
                      <Button
                        key={ci}
                        variant="ghost"
                        onClick={() => submitChoice(c)}
                        disabled={authLoading || !user || busy}
                      >
                        {c}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            )
          )}
          {session.state?.ending_reached && !session.endedAt && (
            <Card style={{ borderColor: COLORS.brass }}>
              <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.ink, marginBottom: 10 }}>
                物語は結末に辿り着いたようだ。
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {/* 他の操作系(選択肢ボタン・自由入力)と同じくbusy中はガードする。
                    そうしないとターン進行中の保存とここでの保存が非同期に競合し、
                    順序保証が無いため直前のターンがIndexedDB/サーバー上で消え得る。 */}
                <Button variant="brass" onClick={finishStory} disabled={busy || narrating}>
                  この物語を終える
                </Button>
                <Button variant="ghost" onClick={keepPlaying} disabled={busy || narrating}>
                  まだ続ける
                </Button>
              </div>
            </Card>
          )}
          {session.endedAt && endingBusy && (
            <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>エンディングを記録しています…</div>
          )}
          {session.endedAt && !endingBusy && ending && (
            <Card style={{ borderColor: COLORS.brass }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink, marginBottom: 8 }}>
                {ending.endingTitle}
              </div>
              {ending.summary && (
                <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, lineHeight: 1.8, marginBottom: 10 }}>
                  {ending.summary}
                </div>
              )}
              <RollStatsLine stats={ending.stats} />
            </Card>
          )}
          {session.endedAt && !endingBusy && !ending && endingError && (
            <Card style={{ borderColor: COLORS.stamp }}>
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 10 }}>{endingError}</div>
              <Button variant="ghost" onClick={recordEndingNow}>
                エンディングを記録する
              </Button>
            </Card>
          )}
          {busy && (
            // 応答待ちであることは目でも支援技術でも取れるようにする。ログが空の
            // セッション開始直後は、この一行だけが「動いている」ことの唯一の手掛かりになる。
            <div role="status" style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
              <div>GMが考えている…</div>
              {slowResponse && (
                <div style={{ marginTop: 4 }}>通常より時間がかかっています。応答を待っています…</div>
              )}
            </div>
          )}
          {error && <div style={{ color: COLORS.stamp, fontSize: 13 }}>{error}</div>}
          {saveWarning && <div style={{ color: COLORS.stamp, fontSize: 12 }}>{saveWarning}</div>}
          {/* ログ末尾の番兵。scroll-margin-bottom があるので、ここへ追従しても
              固定入力欄のぶんだけ手前で止まる。
              高さ0にしないのは、Chromiumが「高さ0 + scroll-margin」の要素を
              block:'nearest' の対象から外し、末尾が画面外にあってもスクロールを
              一切行わないため(追従が丸ごと効かなくなる)。1pxあれば通常の
              nearest の判定に乗る。 */}
          <div ref={logEndRef} style={{ height: 1, scrollMarginBottom: composerReserve }} />
        </div>

        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: docked ? PANEL_W : 0,
            background: mood.paper,
            borderTop: `1px solid ${COLORS.line}`,
            padding: 16,
          }}
        >
          {!authLoading && !user && (
            <div
              id="play-login-prompt"
              role="status"
              style={{
                maxWidth: 720,
                margin: '0 auto 10px',
                padding: '8px 10px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: COLORS.card,
                border: `1px solid ${COLORS.line}`,
                borderRadius: 4,
                fontFamily: F_BODY,
                fontSize: 13,
                color: COLORS.inkSoft,
              }}
            >
              <span>プレイを進めるにはログインが必要です。</span>
              <Button
                variant="brass"
                onClick={() => setLoginOpen(true)}
                style={{ flexShrink: 0, padding: '8px 12px' }}
              >
                ログイン
              </Button>
            </div>
          )}
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitFree();
              }}
              placeholder="PCの行動を自由に書く…"
              aria-describedby={!authLoading && !user ? 'play-login-prompt' : undefined}
              style={{ ...inputStyle, flex: 1 }}
              disabled={authLoading || !user || busy || narrating}
            />
            <Button
              variant="brass"
              onClick={submitFree}
              disabled={authLoading || !user || busy || narrating || !input.trim()}
            >
              送る
            </Button>
          </div>
        </div>

        {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}

        {docked ? (
          <CharacterPanel session={session} docked onRecall={() => recallMemory(session)} />
        ) : (
          panelOpen && (
            <>
              <div
                onClick={() => setPanelOpen(false)}
                // モーダルのスクリムはFocusHeader(zIndex: 30)より上に出し、
                // 開いている間は離脱導線ごと覆って本当にモーダルにする。
                // CharacterPanel(zIndex: 32)よりは下に置く。
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 31 }}
              />
              <CharacterPanel
                session={session}
                docked={false}
                onClose={() => setPanelOpen(false)}
                onRecall={() => recallMemory(session)}
              />
            </>
          )
        )}
      </div>
    </>
  );
}

// テンション別のタイプ速度(ms/字)。highは畳み掛け、lowはゆったり。
const TYPE_SPEED = { high: 15, medium: 25, low: 35 };

// GMの地の文。animate中は一文字ずつ表示し、クリックでスキップできる。
function GmNarrative({ text, animate, speedMs, onDone }) {
  const { shown, done, skip } = useTypewriter(text, { speedMs, enabled: animate });
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);
  return (
    <div
      onClick={done ? undefined : skip}
      style={{
        fontFamily: F_BODY,
        fontSize: 15,
        lineHeight: 1.8,
        color: COLORS.inkSoft,
        whiteSpace: 'pre-wrap',
        cursor: done ? undefined : 'pointer',
      }}
    >
      {shown}
    </div>
  );
}
