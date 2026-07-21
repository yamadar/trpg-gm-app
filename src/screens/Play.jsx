import { useState, useEffect, useRef, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import { takeTurn } from '../api/session.js';
import { saveSession } from '../storage/index.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Stamp from '../components/ui/Stamp.jsx';

export default function Play({ session, setSession, onExit }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logEndRef = useRef(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.log.length, busy]);

  const runTurn = useCallback(
    async (playerText, displayText) => {
      setBusy(true);
      setError('');
      try {
        const { result, roll } = await takeTurn(session, playerText);

        const newFlags = { ...session.state.flags, ...(result.state_update?.flags || {}) };
        const newLog = [...session.log];
        if (displayText) newLog.push({ role: 'player', text: displayText });
        newLog.push({ role: 'gm', text: result.narrative, choices: result.choices || [], roll });

        const recent = [...(session.state.recent_log || [])];
        if (displayText) recent.push({ role: 'player', text: displayText });
        recent.push({ role: 'gm', text: result.narrative });
        while (recent.length > 12) recent.shift(); // 簡易履歴管理。Phase2で要約圧縮に置き換え予定

        const updated = {
          ...session,
          state: {
            ...session.state,
            current_scene: result.state_update?.current_scene || session.state.current_scene,
            flags: newFlags,
            history_summary: result.state_update?.history_summary ?? session.state.history_summary,
            recent_log: recent,
            turn_count: session.state.turn_count + 1,
          },
          log: newLog,
          updatedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);
      } catch (e) {
        console.error(e);
        setError('GM応答の取得に失敗した: ' + e.message);
      } finally {
        setBusy(false);
      }
    },
    [session, setSession]
  );

  useEffect(() => {
    if (session.log.length === 0 && !hasStartedRef.current) {
      hasStartedRef.current = true;
      runTurn('(セッション開始。導入シーンを描写せよ)', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitFree() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    runTurn(text, text);
  }

  function submitChoice(choice) {
    if (busy) return;
    runTurn(choice, choice);
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 140px',
        minHeight: '100vh',
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
        </div>
        <Button variant="ghost" onClick={onExit}>
          ホームへ
        </Button>
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
              <Stamp roll={entry.roll} />
              <div
                style={{
                  fontFamily: F_BODY,
                  fontSize: 15,
                  lineHeight: 1.8,
                  color: COLORS.inkSoft,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {entry.text}
              </div>
              {i === session.log.length - 1 && entry.choices?.length > 0 && (
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
        <div ref={logEndRef} />
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: COLORS.paper,
          borderTop: `1px solid ${COLORS.line}`,
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitFree()}
            placeholder="PCの行動を自由に書く…"
            style={{ ...inputStyle, flex: 1 }}
            disabled={busy}
          />
          <Button variant="brass" onClick={submitFree} disabled={busy || !input.trim()}>
            送る
          </Button>
        </div>
      </div>
    </div>
  );
}
