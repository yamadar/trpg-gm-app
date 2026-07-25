import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import NovelizeProgress from '../components/ui/NovelizeProgress.jsx';
import {
  novelizeSession,
  getNovel,
  getIllustratedNovel,
  putSessionToServer,
  listNovelJobs,
} from '../api/sessionSyncClient.js';
import { publishNovel, unpublishNovel, publishedNovels } from '../api/shareClient.js';
import { advanceCampaignPc } from '../api/session.js';
import { getCampaign, putCampaign, listCampaigns } from '../api/campaignClient.js';
import { listEndings, recordEnding } from '../api/endingClient.js';
import { saveSession } from '../storage/index.js';
import { makeId } from '../utils/makeId.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { summarizeRolls } from '../engine/rollStats.js';
import { navigateToEndings } from '../router/useHashRoute.js';

const NOVEL_POLL_MS = 5000;

function lastLineOf(session) {
  const lastGm = [...session.log].reverse().find((e) => e.role === 'gm');
  if (!lastGm) return '(まだ進行なし)';
  return lastGm.text.slice(0, 60) + (lastGm.text.length > 60 ? '…' : '');
}

function hasIllustrations(session) {
  return !!session.log?.some((e) => e.role === 'gm' && e.image?.imageId);
}

// 操作行のボタンは数が多いので、共通の小さめサイズに揃える。
const ACTION_BTN = { fontSize: 12, padding: '6px 10px' };

export function sanitizeFilename(title) {
  const cleaned = (title || 'session').replace(/[\\/:*?"<>|]/g, '_');
  const trimmed = cleaned.replace(/^\.+/, '').trim();
  return trimmed.length > 0 ? cleaned : 'session';
}

export default function Home({ sessions, storageOk, onNew, onContinue, onOpenLibrary, onOpenGallery, onNextChapter }) {
  const { user } = useAuth();
  const [novelJobs, setNovelJobs] = useState({}); // sessionId -> { status, error, hasNovel, stale }
  // ポーリングが失敗した際、直前まで実行中のジョブがあったかどうかを再試行判定に使う。
  // setNovelJobsは非同期に反映されるため、tick()内の同期チェックにはrefを用いる。
  const hasRunningRef = useRef(false);
  // 経過時間の補間の起点。ポーリング応答を受け取った時刻(クライアント時計)を控える。
  // 差分にしか使わないため、サーバーとの時計ずれの影響を受けない。
  const jobsReceivedAtRef = useRef(0);
  const [pollNonce, setPollNonce] = useState(0);
  const [novelizeError, setNovelizeError] = useState({});
  const [publishedNovelIds, setPublishedNovelIds] = useState({});
  const [publishBusy, setPublishBusy] = useState({});
  const [advancing, setAdvancing] = useState({});
  const [campaignMap, setCampaignMap] = useState({}); // campaignId -> { title, chapterCount }
  const [endingMap, setEndingMap] = useState({}); // sessionId -> エンディング記録
  const [endingsLoaded, setEndingsLoaded] = useState(false);
  const [endingBusy, setEndingBusy] = useState({});

  // novelJobsの更新経路(マウント時取得・ポーリング・楽観的更新)をすべてここに通し、
  // hasRunningRefを常に最新の状態と一致させる。
  function applyNovelJobs(updater) {
    setNovelJobs((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      hasRunningRef.current = Object.values(next).some((j) => j.status === 'running');
      return next;
    });
  }

  const anyRunning = Object.values(novelJobs).some((j) => j.status === 'running');

  // 実行中のジョブがある間だけ1秒ごとに再描画し、経過時間の表示を進める。
  // ポーリング(5秒)の更新だけに任せると数字が5秒刻みで飛び、止まって見える。
  // 値そのものは使わないため、setterだけを受け取る。
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  useEffect(() => {
    const worldIds = [...new Set(sessions.filter((s) => s.campaignId && s.worldId).map((s) => s.worldId))];
    if (!user || worldIds.length === 0) {
      setCampaignMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const map = {};
      await Promise.all(
        worldIds.map(async (wid) => {
          try {
            const list = await listCampaigns(wid);
            for (const c of list) {
              map[c.id] = { title: c.title, chapterCount: (c.chapters || []).length };
            }
          } catch {
            // 1つのWorldの取得に失敗しても他は表示する(該当campaignは非グループへフォールバック)
          }
        })
      );
      if (!cancelled) setCampaignMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, user]);

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

  useEffect(() => {
    if (!user) {
      setEndingMap({});
      setEndingsLoaded(true); // ログアウト状態でも「未取得」のまま記録ボタンを隠し続けないようにする
      return;
    }
    let cancelled = false;
    setEndingsLoaded(false);
    (async () => {
      try {
        const list = await listEndings();
        if (!cancelled) setEndingMap(Object.fromEntries(list.map((e) => [e.sessionId, e])));
      } catch {
        // 記録の取得に失敗してもホーム自体は使えるようにする(黙って無視する)
      } finally {
        // 取得が終わるまでendingMapは空のままなので、ここで確定させる前に
        // 「記録する」ボタンを出すと、既に記録済みのセッションでも一瞬押せてしまい、
        // AI命名が再実行されて改名済みタイトルを上書きし利用枠を消費してしまう。
        // 失敗時も含めて必ずtrueにし、ボタンが永久に隠れたままにならないようにする。
        if (!cancelled) setEndingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 小説化の進行状況はサーバーが真実源。リロードや画面遷移を跨いでも「小説化中…」が
  // 維持されるよう、マウント時に取得し、実行中のジョブがある間だけ定期的に追う。
  useEffect(() => {
    if (!user) {
      applyNovelJobs({});
      return;
    }
    let cancelled = false;
    let timer = null;
    (async function tick() {
      try {
        const jobs = await listNovelJobs();
        if (cancelled) return;
        jobsReceivedAtRef.current = Date.now();
        // 置き換えではなくマージする: 小説化ボタン押下直後はポーリングを即座に
        // 再始動するため(下のhandleNovelize参照)、サーバーがまだジョブ開始を
        // 記録し切っていないタイミングでこのポーリングが先に返ってくることがある。
        // そこで空扱いのセッションを丸ごと消さず、応答に含まれる分だけ上書きする。
        applyNovelJobs((prev) => ({ ...prev, ...jobs }));
        if (Object.values(jobs).some((j) => j.status === 'running')) {
          timer = setTimeout(tick, NOVEL_POLL_MS);
        }
      } catch {
        // 一時的な通信断でポーリングが止まると「小説化中…」のまま固まるため、
        // 実行中とみなしている間は再試行を続ける(セッション一覧を離れて
        // 戻る・リロードするまで待たせない)。
        if (!cancelled && hasRunningRef.current) timer = setTimeout(tick, NOVEL_POLL_MS);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user, pollNonce]);

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
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    // 押した直後から「小説化中…」にする。以降はポーリング結果で上書きされる。
    applyNovelJobs((prev) => ({
      ...prev,
      [session.id]: { ...(prev[session.id] || {}), status: 'running', error: null },
    }));
    try {
      await novelizeSession(session.id);
    } catch (err) {
      applyNovelJobs((prev) => ({
        ...prev,
        [session.id]: { ...(prev[session.id] || {}), status: 'error', error: err.message },
      }));
      return;
    }
    setPollNonce((n) => n + 1); // ポーリングを再始動する
  }

  async function handleDownloadNovel(e, session) {
    e.stopPropagation();
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const { text } = await getNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}.md`, text);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '小説の取得に失敗した: ' + err.message }));
    }
  }

  async function handleDownloadIllustrated(e, session) {
    e.stopPropagation();
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const { markdown } = await getIllustratedNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}-挿絵付き.md`, markdown);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '挿絵付き小説の取得に失敗した: ' + err.message }));
    }
  }

  async function handleNextChapter(e, session) {
    e.stopPropagation();
    setAdvancing((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const { pcRaw, xp } = await advanceCampaignPc(session);
      let campaignId = session.campaignId;
      let campaign = campaignId ? await getCampaign(session.worldId, campaignId).catch(() => null) : null;
      const chapter = { sessionId: session.id, title: session.title, endedAt: Date.now() };
      if (campaign) {
        campaign = {
          ...campaign,
          carriedPc: { raw: pcRaw, xp },
          chapters: [...(campaign.chapters || []), chapter],
        };
      } else {
        campaignId = makeId('cp');
        campaign = { id: campaignId, worldId: session.worldId, title: session.title, carriedPc: { raw: pcRaw, xp }, chapters: [chapter] };
      }
      await putCampaign(session.worldId, campaignId, {
        title: campaign.title,
        carriedPc: campaign.carriedPc,
        chapters: campaign.chapters,
      });
      // 次章へ進む＝この章は終わり。キャンペーン側のchapters[].endedAtと足並みを揃える。
      const ended = {
        ...session,
        campaignId,
        endedAt: session.endedAt || Date.now(),
        updatedAt: Date.now(),
      };
      await saveSession(ended);
      putSessionToServer(ended).catch((err) => console.error('session server sync failed', err));
      onNextChapter?.({
        worldId: session.worldId,
        world: session.world,
        moods: session.moods || [],
        pcRaw,
        xp,
        rulesetId: session.rulesetId,
        campaignId,
      });
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '次章の準備に失敗した: ' + err.message }));
    } finally {
      setAdvancing((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }

  // Play画面での確定時に記録できなかった場合(命名失敗・旧データ)の受け皿。
  async function handleRecordEnding(e, session) {
    e.stopPropagation();
    setEndingBusy((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const ending = await recordEnding(session.id, summarizeRolls(session));
      setEndingMap((prev) => ({ ...prev, [session.id]: ending }));
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: 'エンディングの記録に失敗した: ' + err.message }));
    } finally {
      setEndingBusy((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }

  function renderSessionCard(s) {
    const job = novelJobs[s.id] || {};
    const ending = endingMap[s.id];
    const running = job.status === 'running';
    // サーバーが返した経過時間に、受信からの実時間を足して補間する。
    // 楽観的更新の直後(elapsedMs未取得)は0から始める。
    const elapsedMs =
      running && typeof job.elapsedMs === 'number' ? job.elapsedMs + (Date.now() - jobsReceivedAtRef.current) : 0;
    const hasNovel = job.status === 'done' || !!job.hasNovel;
    const badges = [];
    if (s.endedAt) badges.push(<Badge key="ended" variant="brass">完結</Badge>);
    if (publishedNovelIds[s.id]) badges.push(<Badge key="published" variant="outline">公開中</Badge>);
    if (hasIllustrations(s)) badges.push(<Badge key="illustrated" variant="faint">挿絵あり</Badge>);

    return (
      <Card key={s.id} style={{ cursor: 'pointer' }} onClick={() => onContinue(s.id)}>
        {/* 情報層 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{s.title}</div>
              {s.state?.current_scene && (
                <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, whiteSpace: 'nowrap' }}>
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
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brass, whiteSpace: 'nowrap' }}>続ける →</div>
        </div>

        {/* 状態バッジ層。押せる要素と混同されないようボタン行とは分ける。 */}
        {badges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{badges}</div>
        )}

        {ending && (
          <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginTop: 8 }}>
            エンディング: {ending.endingTitle}
          </div>
        )}

        {(novelizeError[s.id] || (job.status === 'error' && job.error)) && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp, marginTop: 8 }}>
            {novelizeError[s.id] || `小説化に失敗した: ${job.error}`}
          </div>
        )}
        {hasNovel && job.stale && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.brassDark, marginTop: 8 }}>
            生成済みの小説は最新のログを反映していない可能性があります。
          </div>
        )}
        {hasNovel && job.truncated && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.brassDark, marginTop: 8 }}>
            小説が出力上限に達したため、末尾が欠けている可能性があります。
          </div>
        )}
        {running && <NovelizeProgress elapsedMs={elapsedMs} />}

        {/* 操作層 */}
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
          {running ? (
            <Button variant="ghost" disabled style={ACTION_BTN}>
              小説化中…
            </Button>
          ) : (
            <>
              {hasNovel && (
                <Button variant="ghost" onClick={(e) => handleDownloadNovel(e, s)} style={ACTION_BTN}>
                  小説をDL
                </Button>
              )}
              {hasNovel && hasIllustrations(s) && (
                <Button variant="ghost" onClick={(e) => handleDownloadIllustrated(e, s)} style={ACTION_BTN}>
                  挿絵付きでDL
                </Button>
              )}
              <Button variant="ghost" onClick={(e) => handleNovelize(e, s)} disabled={!user} style={ACTION_BTN}>
                {job.status === 'error' ? '小説化を再試行' : hasNovel ? '小説を再生成' : '小説化する'}
              </Button>
            </>
          )}
          {s.worldId && (
            <Button
              variant="ghost"
              onClick={(e) => handleNextChapter(e, s)}
              disabled={!!advancing[s.id] || !user}
              style={ACTION_BTN}
            >
              {advancing[s.id] ? '準備中…' : '次の章へ'}
            </Button>
          )}
          {s.endedAt && endingsLoaded && !ending && (
            <Button
              variant="ghost"
              onClick={(e) => handleRecordEnding(e, s)}
              disabled={!!endingBusy[s.id] || !user}
              style={ACTION_BTN}
            >
              {endingBusy[s.id] ? '記録中…' : 'エンディングを記録する'}
            </Button>
          )}
          {user &&
            (publishedNovelIds[s.id] ? (
              <Button
                variant="ghost"
                onClick={(e) => handleUnpublish(e, s)}
                disabled={!!publishBusy[s.id]}
                style={ACTION_BTN}
              >
                公開解除
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={(e) => handlePublish(e, s)}
                disabled={!!publishBusy[s.id]}
                style={ACTION_BTN}
              >
                小説を公開
              </Button>
            ))}
        </div>
      </Card>
    );
  }

  const grouped = [];
  const standalone = [];
  const groupsById = {};
  for (const s of sessions) {
    const meta = s.campaignId ? campaignMap[s.campaignId] : null;
    if (meta) {
      if (!groupsById[s.campaignId]) {
        groupsById[s.campaignId] = {
          campaignId: s.campaignId,
          title: meta.title,
          chapterCount: meta.chapterCount,
          items: [],
          latest: 0,
        };
        grouped.push(groupsById[s.campaignId]);
      }
      const g = groupsById[s.campaignId];
      g.items.push(s);
      g.latest = Math.max(g.latest, s.updatedAt || 0);
    } else {
      standalone.push(s);
    }
  }
  grouped.sort((a, b) => b.latest - a.latest);
  grouped.forEach((g) => g.items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));

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
        <Button variant="ghost" onClick={navigateToEndings}>
          エンディング図鑑
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

      {grouped.map((g) => (
        <div key={g.campaignId} style={{ marginBottom: 28 }}>
          <div
            style={{
              fontFamily: F_DISPLAY,
              fontSize: 14,
              color: COLORS.brassDark,
              marginBottom: 10,
              letterSpacing: 0.5,
            }}
          >
            {g.title}
            <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}> 全{g.chapterCount}章</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {g.items.map(renderSessionCard)}
          </div>
        </div>
      ))}

      {standalone.length > 0 && (
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
            {standalone.map(renderSessionCard)}
          </div>
        </>
      )}
    </div>
  );
}
