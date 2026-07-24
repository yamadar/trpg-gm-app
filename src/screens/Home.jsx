import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { novelizeSession, getNovel, getIllustratedNovel } from '../api/sessionSyncClient.js';
import { publishNovel, unpublishNovel, publishedNovels } from '../api/shareClient.js';
import { useAuth } from '../auth/AuthContext.jsx';

function lastLineOf(session) {
  const lastGm = [...session.log].reverse().find((e) => e.role === 'gm');
  if (!lastGm) return '(まだ進行なし)';
  return lastGm.text.slice(0, 60) + (lastGm.text.length > 60 ? '…' : '');
}

export function sanitizeFilename(title) {
  const cleaned = (title || 'session').replace(/[\\/:*?"<>|]/g, '_');
  const trimmed = cleaned.replace(/^\.+/, '').trim();
  return trimmed.length > 0 ? cleaned : 'session';
}

export default function Home({ sessions, storageOk, onNew, onContinue, onOpenLibrary, onOpenGallery }) {
  const { user } = useAuth();
  const [novelizing, setNovelizing] = useState({});
  const [novelizeError, setNovelizeError] = useState({});
  const [publishedNovelIds, setPublishedNovelIds] = useState({});
  const [publishBusy, setPublishBusy] = useState({});

  useEffect(() => {
    if (!user) {
      setPublishedNovelIds({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const map = await publishedNovels();
        if (!cancelled) setPublishedNovelIds(map);
      } catch {
        // 公開状態の取得に失敗してもホーム画面自体は使えるようにする(黙って無視する)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handlePublish(e, session) {
    e.stopPropagation();
    setPublishBusy((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const { publicId } = await publishNovel(session.id);
      setPublishedNovelIds((prev) => ({ ...prev, [session.id]: publicId }));
    } catch (err) {
      setNovelizeError((prev) => ({
        ...prev,
        [session.id]: err.status === 409 ? '先に小説化してください' : err.message,
      }));
    } finally {
      setPublishBusy((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }

  async function handleUnpublish(e, session) {
    e.stopPropagation();
    setPublishBusy((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await unpublishNovel(session.id);
      setPublishedNovelIds((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: err.message }));
    } finally {
      setPublishBusy((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }

  function downloadMarkdown(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function handleNovelize(e, session) {
    e.stopPropagation();
    setNovelizing((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await novelizeSession(session.id);
      const { text, stale } = await getNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}.md`, text);
      if (stale) {
        setNovelizeError((prev) => ({
          ...prev,
          [session.id]: 'ダウンロードした小説は最新のログを反映していない可能性があります。',
        }));
      }
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '小説化に失敗した: ' + err.message }));
    } finally {
      setNovelizing((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }

  async function handleNovelizeIllustrated(e, session) {
    e.stopPropagation();
    setNovelizing((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await novelizeSession(session.id);
      const { markdown } = await getIllustratedNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}-挿絵付き.md`, markdown);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '挿絵付き小説化に失敗した: ' + err.message }));
    } finally {
      setNovelizing((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
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

      <div style={{ display: 'flex', gap: 10, marginBottom: user ? 32 : 8 }}>
        <Button variant="brass" onClick={onNew} disabled={!user}>
          + 新規プレイ
        </Button>
        <Button variant="ghost" onClick={onOpenLibrary}>
          素材ライブラリ
        </Button>
        <Button variant="ghost" onClick={onOpenGallery}>
          公開ギャラリー
        </Button>
      </div>

      {!user && (
        <div
          style={{
            fontFamily: F_MONO,
            fontSize: 12,
            color: COLORS.faint,
            marginBottom: 24,
          }}
        >
          プレイと小説化にはログインが必要です(右上からログイン)
        </div>
      )}

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
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Button
                        variant="ghost"
                        onClick={(e) => handleNovelize(e, s)}
                        disabled={!!novelizing[s.id] || !user}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        {novelizing[s.id] ? '小説化中…' : '小説化'}
                      </Button>
                      {s.log?.some((en) => en.role === 'gm' && en.image?.imageId) && (
                        <Button
                          variant="ghost"
                          onClick={(e) => handleNovelizeIllustrated(e, s)}
                          disabled={!!novelizing[s.id] || !user}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                        >
                          挿絵付き
                        </Button>
                      )}
                      {user &&
                        (publishedNovelIds[s.id] ? (
                          <>
                            <span
                              style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark }}
                            >
                              公開中
                            </span>
                            <Button
                              variant="ghost"
                              onClick={(e) => handleUnpublish(e, s)}
                              disabled={!!publishBusy[s.id]}
                              style={{ fontSize: 11, padding: '4px 8px' }}
                            >
                              公開解除
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={(e) => handlePublish(e, s)}
                            disabled={!!publishBusy[s.id]}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                          >
                            小説を公開
                          </Button>
                        ))}
                    </div>
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
