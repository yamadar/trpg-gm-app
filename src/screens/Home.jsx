import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { novelizeSession, getNovel } from '../api/sessionSyncClient.js';

function lastLineOf(session) {
  const lastGm = [...session.log].reverse().find((e) => e.role === 'gm');
  if (!lastGm) return '(まだ進行なし)';
  return lastGm.text.slice(0, 60) + (lastGm.text.length > 60 ? '…' : '');
}

function sanitizeFilename(title) {
  return (title || 'session').replace(/[\\/:*?"<>|]/g, '_');
}

export default function Home({ sessions, storageOk, onNew, onContinue, onOpenLibrary }) {
  const [novelizingId, setNovelizingId] = useState(null);
  const [novelizeError, setNovelizeError] = useState({});

  async function handleNovelize(e, session) {
    e.stopPropagation();
    setNovelizingId(session.id);
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await novelizeSession(session.id);
      const { text } = await getNovel(session.id);
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(session.title)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '小説化に失敗した: ' + err.message }));
    } finally {
      setNovelizingId(null);
    }
  }

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

      <div style={{ display: 'flex', gap: 10, marginBottom: 32 }}>
        <Button variant="brass" onClick={onNew}>
          + 新規プレイ
        </Button>
        <Button variant="ghost" onClick={onOpenLibrary}>
          素材ライブラリ
        </Button>
      </div>

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
                    {novelizeError[s.id] && (
                      <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp, marginTop: 4 }}>
                        {novelizeError[s.id]}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div
                      style={{
                        fontFamily: F_MONO,
                        fontSize: 12,
                        color: COLORS.brass,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      続ける →
                    </div>
                    <Button
                      variant="ghost"
                      onClick={(e) => handleNovelize(e, s)}
                      disabled={novelizingId === s.id}
                      style={{ fontSize: 11, padding: '4px 8px' }}
                    >
                      {novelizingId === s.id ? '小説化中…' : '小説化'}
                    </Button>
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
