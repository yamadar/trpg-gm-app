import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';

function lastLineOf(session) {
  const lastGm = [...session.log].reverse().find((e) => e.role === 'gm');
  if (!lastGm) return '(まだ進行なし)';
  return lastGm.text.slice(0, 60) + (lastGm.text.length > 60 ? '…' : '');
}

export default function Home({ sessions, storageOk, onNew, onContinue }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1
        style={{
          fontFamily: F_DISPLAY,
          fontSize: 32,
          color: COLORS.ink,
          marginBottom: 4,
          letterSpacing: 1,
        }}
      >
        GM's Desk
      </h1>
      <p
        style={{
          fontFamily: F_BODY,
          color: COLORS.inkSoft,
          fontSize: 14,
          marginBottom: 32,
        }}
      >
        AIがGMを務めるインタラクティブ物語
      </p>

      {!storageOk && (
        <div
          style={{
            fontFamily: F_MONO,
            fontSize: 12,
            color: COLORS.stamp,
            border: `1px solid ${COLORS.stamp}`,
            borderRadius: 4,
            padding: '10px 12px',
            marginBottom: 24,
          }}
        >
          この環境では保存機能(IndexedDB)が使えていない。「続きから再開」は動作せず、ページを離れると進行が失われる。ブラウザのコンソールにエラー詳細が出ている。
        </div>
      )}

      <Button variant="brass" onClick={onNew} style={{ marginBottom: 32 }}>
        + 新規プレイ
      </Button>

      {sessions.length > 0 && (
        <>
          <div
            style={{
              fontFamily: F_DISPLAY,
              fontSize: 13,
              color: COLORS.brassDark,
              marginBottom: 12,
              letterSpacing: 0.5,
            }}
          >
            続きから再開
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map((s) => (
              <Card key={s.id} style={{ cursor: 'pointer' }} onClick={() => onContinue(s.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>
                        {s.title}
                      </div>
                      {s.state?.current_scene && (
                        <div
                          style={{
                            fontFamily: F_MONO,
                            fontSize: 11,
                            color: COLORS.brassDark,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          シーン: {s.state.current_scene}
                          {typeof s.state.turn_count === 'number' ? ` / ${s.state.turn_count}手` : ''}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: F_BODY,
                        fontSize: 13,
                        color: COLORS.inkSoft,
                        opacity: 0.8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lastLineOf(s)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: F_MONO,
                      fontSize: 12,
                      color: COLORS.brass,
                      alignSelf: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    続ける →
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
