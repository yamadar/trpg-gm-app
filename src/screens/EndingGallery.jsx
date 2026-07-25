import { useState, useEffect, useMemo } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import RollStatsLine from '../components/ui/RollStatsLine.jsx';
import ConfirmModal from '../components/library/ConfirmModal.jsx';
import { listEndings, renameEnding, deleteEnding } from '../api/endingClient.js';
import { evaluateAchievements } from '../engine/achievements.js';
import AchievementTile from '../components/achievements/AchievementTile.jsx';
import AchievementProgressBar from '../components/achievements/AchievementProgressBar.jsx';
import { navigateToAchievements } from '../router/useHashRoute.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatDate } from '../utils/formatDate.js';

export default function EndingGallery({ onClose }) {
  const { user } = useAuth();
  const [endings, setEndings] = useState([]);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    if (!user) {
      setEndings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listEndings();
        if (!cancelled) setEndings(list);
      } catch (e) {
        if (!cancelled) setError('エンディングの取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 改名入力欄のキー入力のたびに再計算されないよう、endingsが変わった時だけ導出する。
  const achievements = useMemo(() => evaluateAchievements(endings), [endings]);
  // 図鑑では取得済みの直近3件だけを見せ、全件は #/achievements に任せる。
  // 件数が増えても図鑑本体(エンディング一覧)が押し下げられないようにするため。
  const earned = useMemo(() => achievements.filter((a) => a.earned), [achievements]);
  const recent = useMemo(
    () => [...earned].sort((a, b) => (b.earnedAt || 0) - (a.earnedAt || 0)).slice(0, 3),
    [earned]
  );

  async function saveTitle(sessionId) {
    setBusyId(sessionId);
    setError('');
    try {
      const updated = await renameEnding(sessionId, draftTitle.trim());
      setEndings((prev) => prev.map((e) => (e.sessionId === sessionId ? updated : e)));
      setEditingId(null);
    } catch (e) {
      setError('改名に失敗した: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const sessionId = pendingDelete;
    setBusyId(sessionId);
    setError('');
    try {
      await deleteEnding(sessionId);
      setEndings((prev) => prev.filter((e) => e.sessionId !== sessionId));
      setPendingDelete(null);
    } catch (e) {
      // モーダルを開いたままだとエラーメッセージがオーバーレイの裏に隠れて読めないため、
      // 失敗時もモーダルを閉じてエラーを見えるようにする。
      setPendingDelete(null);
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ fontFamily: F_DISPLAY, fontSize: 28, color: COLORS.ink, letterSpacing: 1 }}>エンディング図鑑</h1>
        <Button variant="ghost" onClick={onClose}>
          ホームへ
        </Button>
      </div>

      {!user && (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginBottom: 24 }}>
          エンディング図鑑の閲覧にはログインが必要です(右上からログイン)
        </div>
      )}

      {error && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 16 }}>{error}</div>
      )}

      {user && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark }}>
              {/* 件数だけを1つのテキストノードにする(AchievementListと同じ形)。ラベルと同じdivだと
                  「実績 」の接頭辞が混ざり、"3 / 50"のようなテキストマッチが効かなくなるため。 */}
              実績 <span>{earned.length} / {achievements.length}</span>
            </div>
            <Button variant="ghost" onClick={navigateToAchievements} style={{ fontSize: 12, padding: '6px 10px' }}>
              すべて見る →
            </Button>
          </div>
          <AchievementProgressBar
            current={earned.length}
            target={achievements.length}
            label="実績の取得状況"
          />
          {recent.length === 0 ? (
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, marginTop: 10 }}>
              まだ実績がありません。物語を結末まで進めると集まります。
            </div>
          ) : (
            <>
              <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, margin: '14px 0 8px' }}>
                直近の獲得
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                {recent.map((a) => (
                  <AchievementTile key={a.id} achievement={a} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark, marginBottom: 10 }}>
        到達したエンディング
      </div>
      {user && endings.length === 0 && !error && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
          まだエンディングの記録がありません。物語を結末まで進めて「この物語を終える」を押すと記録されます。
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {endings.map((e) => (
          <Card key={e.sessionId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              {editingId === e.sessionId ? (
                <input
                  value={draftTitle}
                  onChange={(ev) => setDraftTitle(ev.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
              ) : (
                <div style={{ fontFamily: F_DISPLAY, fontSize: 17, color: COLORS.ink }}>{e.endingTitle}</div>
              )}
              <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap' }}>
                {formatDate(e.endedAt)}
              </div>
            </div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 4 }}>
              セッション: {e.sessionTitle}
            </div>
            {e.moods?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {e.moods.map((m) => (
                  <Badge key={m} variant="outline">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
            {e.summary && (
              <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, lineHeight: 1.8, marginTop: 10 }}>
                {e.summary}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <RollStatsLine stats={e.stats} />
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${COLORS.line}`,
              }}
            >
              {editingId === e.sessionId ? (
                <>
                  <Button
                    variant="brass"
                    onClick={() => saveTitle(e.sessionId)}
                    disabled={busyId === e.sessionId || draftTitle.trim() === ''}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  >
                    保存
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)} style={{ fontSize: 12, padding: '6px 10px' }}>
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingId(e.sessionId);
                      setDraftTitle(e.endingTitle);
                    }}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  >
                    改名
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPendingDelete(e.sessionId)}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  >
                    削除
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        message="このエンディングの記録を削除しますか?(セッション自体は消えません)"
        confirmDisabled={busyId !== null}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
