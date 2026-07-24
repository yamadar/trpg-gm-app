import { useState, useEffect, useRef, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle, motionAllowed, moodTheme } from '../theme.js';
import { useTypewriter } from '../hooks/useTypewriter.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import CharacterPanel from '../components/play/CharacterPanel.jsx';
import { takeTurn } from '../api/session.js';
import { saveSession } from '../storage/index.js';
import { putSessionToServer } from '../api/sessionSyncClient.js';
import { normalizeTurnResult } from '../api/turnResult.js';
import { generateSceneImage, sceneImageUrl, getConfig } from '../api/sceneImageClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Stamp from '../components/ui/Stamp.jsx';

export default function Play({ session, setSession, onExit }) {
  const { user, loading: authLoading } = useAuth();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveWarning, setSaveWarning] = useState('');
  const [narrating, setNarrating] = useState(false);
  const handleNarrationDone = useCallback(() => setNarrating(false), []);
  const [imageGen, setImageGen] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState(null);
  const [imageError, setImageError] = useState(null); // { index, message } | null
  const logEndRef = useRef(null);
  const hasStartedRef = useRef(false);
  // 常に最新のセッションを指すref。非同期処理(挿絵生成・ターン)の完了時に
  // 捕捉した古いセッションで上書きして進行を巻き戻さないよう、完了時点の最新を読む。
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const mood = moodTheme(session.moods);
  const docked = useMediaQuery('(min-width: 1024px)');
  const [panelOpen, setPanelOpen] = useState(false);
  const PANEL_W = 320;
  // マウント時点のログ長。これ以降に追加されたエントリだけを演出対象にする
  // (セッション再開時に履歴全体が演出され直すのを防ぐ)。
  const initialLogLenRef = useRef(session.log.length);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.log.length, busy]);

  useEffect(() => {
    getConfig()
      .then((c) => setImageGen(!!c.imageGen))
      .catch(() => setImageGen(false));
  }, []);

  // 挿絵生成。baseSession を引数に取り、手動ボタンとシーン変化時の自動生成の双方で再利用する。
  // runTurn より前に定義し、runTurn から参照できるようにする。
  const illustrate = useCallback(
    async (baseSession, i) => {
      if (generatingIndex !== null) return;
      setGeneratingIndex(i);
      setImageError(null);
      try {
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
    async (playerText, displayText) => {
      if (!user) {
        setError('プレイの進行にはログインが必要です。右上からログインしてください。');
        return false;
      }
      setBusy(true);
      setError('');
      try {
        const { result, roll } = await takeTurn(session, playerText);
        const norm = normalizeTurnResult(result);

        const newFlags = norm.stateUpdate.flags
          ? { ...session.state.flags, ...norm.stateUpdate.flags }
          : session.state.flags;
        const newXp = (Number.isFinite(session.state.xp) ? session.state.xp : 0) + norm.stateUpdate.xpGain;
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
        if (user) putSessionToServer(updated).catch((e) => console.error('session server sync failed', e));

        const sceneChanged =
          !!norm.stateUpdate.current_scene && norm.stateUpdate.current_scene !== session.state.current_scene;
        if (imageGen && updated.autoIllustrate && sceneChanged) {
          const gmIndex = updated.log.length - 1;
          illustrate(updated, gmIndex);
        }
        return true;
      } catch (e) {
        console.error(e);
        setError('GM応答の取得に失敗した: ' + e.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [session, setSession, user, imageGen, illustrate]
  );

  useEffect(() => {
    if (authLoading) return;
    if (session.log.length === 0 && !hasStartedRef.current) {
      hasStartedRef.current = true;
      runTurn('(セッション開始。導入シーンを描写せよ)', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  async function submitFree() {
    if (!input.trim() || busy || narrating) return;
    const text = input.trim();
    setInput('');
    const ok = await runTurn(text, text);
    if (!ok) setInput(text);
  }

  function submitChoice(choice) {
    if (busy || narrating) return;
    runTurn(choice, choice);
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 140px',
        minHeight: '100vh',
        background: mood.paper,
        ...(docked ? { paddingRight: PANEL_W + 20 } : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink }}>
            {session.title}
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            シーン: {session.state.current_scene}
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            {session.ruleset?.growthUnit || '経験値'}: {session.state.xp || 0}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {!docked && (
            <Button variant="ghost" onClick={() => setPanelOpen((v) => !v)} style={{ marginRight: 12 }}>
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
                marginRight: 12,
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
          <Button variant="ghost" onClick={onExit}>
            ホームへ
          </Button>
        </div>
      </div>

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
                    <Button key={ci} variant="ghost" onClick={() => submitChoice(c)} disabled={busy}>
                      {c}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          )
        )}
        {busy && (
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
            GMが考えている…
          </div>
        )}
        {error && <div style={{ color: COLORS.stamp, fontSize: 13 }}>{error}</div>}
        {saveWarning && <div style={{ color: COLORS.stamp, fontSize: 12 }}>{saveWarning}</div>}
        <div ref={logEndRef} />
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
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitFree();
            }}
            placeholder="PCの行動を自由に書く…"
            style={{ ...inputStyle, flex: 1 }}
            disabled={busy || narrating}
          />
          <Button variant="brass" onClick={submitFree} disabled={busy || narrating || !input.trim()}>
            送る
          </Button>
        </div>
      </div>

      {docked ? (
        <CharacterPanel session={session} docked />
      ) : (
        panelOpen && (
          <>
            <div
              onClick={() => setPanelOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 19 }}
            />
            <CharacterPanel session={session} docked={false} onClose={() => setPanelOpen(false)} />
          </>
        )
      )}
    </div>
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
