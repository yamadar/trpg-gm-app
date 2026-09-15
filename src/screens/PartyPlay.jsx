import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, F_BODY, F_DISPLAY, F_MONO, inputStyle } from '../theme.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import {
  claimPartyPc,
  createPartyInvite,
  deletePartyIntent,
  getPartyChat,
  getPartySnapshot,
  heartbeatPartyTyping,
  hostAdvanceParty,
  hostEndParty,
  hostPauseParty,
  hostResumeParty,
  readyParty,
  returnToParty,
  sendPartyChat,
  setPartyAway,
  startPartySession,
  submitPartyIntent,
  unreadyParty,
  voteParty,
  updatePartySettings,
} from '../api/partyClient.js';
import FocusHeader from '../components/nav/FocusHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import ConfirmModal from '../components/library/ConfirmModal.jsx';
import { navigate } from '../navigation/useRoute.js';

const PHASE_LABELS = {
  lobby: 'ロビー',
  collecting: '行動受付中',
  lock_grace: 'まもなく確定',
  resolving: 'AI GM処理中',
  deciding: 'Party決定',
  paused: '進行停止',
  ended: '終了',
};

const MAX_VISIBLE_CHAT_MESSAGES = 500;

function commandId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function statusText(participant) {
  if (participant.activity === 'away_manual') return '離席';
  if (participant.activity === 'away_auto') return '自動離席';
  if (participant.typing) return '入力中…';
  if (participant.activity === 'ready') return '確定';
  if (participant.connection === 'offline') return '切断';
  if (participant.connection === 'reconnecting') return '再接続待ち';
  return '参加中';
}

function ParticipantList({ party }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {party.participants.map((participant) => {
        const pc = party.pcs.find((item) => item.id === participant.pcId);
        return (
          <div key={participant.userId} style={{ borderBottom: `1px solid ${COLORS.line}`, paddingBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.ink }}>{participant.displayName}</span>
              <Badge variant={participant.activity?.startsWith('away') ? 'faint' : 'outline'}>{statusText(participant)}</Badge>
            </div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
              {pc?.characterName || 'PC未選択'}{participant.role === 'host' ? ' / ホスト' : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PartyPlay({ sessionId }) {
  const mobile = useMediaQuery('(max-width: 1080px)');
  const [party, setParty] = useState(null);
  const [chat, setChat] = useState([]);
  const [actionText, setActionText] = useState('');
  const [chatText, setChatText] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [endConfirm, setEndConfirm] = useState(false);
  const [mobileTab, setMobileTab] = useState('story');
  const fetchingRef = useRef(false);
  const chatFetchingRef = useRef(false);
  const typingAtRef = useRef(0);
  const roundRef = useRef(null);
  const lastSubmittedRef = useRef('');
  const latestStoryRef = useRef(null);
  const appliedSeqRef = useRef(-1);
  const activeRef = useRef(true);
  const chatSeqRef = useRef(0);
  const chatInitializedRef = useRef(false);

  const applySnapshot = useCallback((snapshot) => {
    if (!activeRef.current || !snapshot?.snapshot) return;
    const seq = snapshot.eventSeq ?? 0;
    if (seq < appliedSeqRef.current) return;
    appliedSeqRef.current = seq;
    setParty(snapshot);
    if (Number.isFinite(snapshot.serverNow)) setServerOffset(snapshot.serverNow - Date.now());
  }, []);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return fetchingRef.current;
    const task = getPartySnapshot(sessionId).then((snapshot) => {
      applySnapshot(snapshot);
      if (activeRef.current) setSyncError('');
    }).catch((e) => {
      if (activeRef.current) setSyncError('進行状態を再取得中: ' + e.message);
    });
    if (!chatFetchingRef.current) {
      chatFetchingRef.current = true;
      getPartyChat(sessionId, chatSeqRef.current).then((messages) => {
        if (!activeRef.current) return;
        const incoming = Array.isArray(messages.messages) ? messages.messages : [];
        const initial = !chatInitializedRef.current;
        if (initial || incoming.length) {
          setChat((current) => {
            const known = new Set(current.map((message) => message.id));
            return (initial ? incoming : [...current, ...incoming.filter((message) => !known.has(message.id))]).slice(-MAX_VISIBLE_CHAT_MESSAGES);
          });
        }
        chatSeqRef.current = Math.max(chatSeqRef.current, messages.nextSeq || 0, ...incoming.map((message) => message.seq || 0));
        chatInitializedRef.current = true;
      }).catch(() => {}).finally(() => { chatFetchingRef.current = false; });
    }
    fetchingRef.current = task;
    try { await task; } finally { fetchingRef.current = null; }
  }, [sessionId, applySnapshot]);

  useEffect(() => {
    activeRef.current = true;
    refresh();
    const poll = setInterval(refresh, 1000);
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => {
      activeRef.current = false;
      clearInterval(poll);
      clearInterval(timer);
    };
  }, [refresh]);

  const myParticipant = party?.participants.find((item) => item.userId === party.me.userId);
  const myIntent = party?.round?.intents.find((intent) => intent.pcId === party.me.pcId && intent.source === 'human');
  const isReady = party?.round?.readyUserIds.includes(party?.me.userId);

  useEffect(() => {
    const roundId = party?.round?.id || null;
    if (roundRef.current !== roundId) {
      roundRef.current = roundId;
      setActionText((draft) => draft && draft !== lastSubmittedRef.current ? draft : myIntent?.text || '');
      if (lastSubmittedRef.current) setDraftNotice('ラウンドが進んだ。未送信の編集があれば入力欄に保持している。');
      lastSubmittedRef.current = myIntent?.text || '';
    }
  }, [party?.round?.id, myIntent?.text]);

  const remaining = useMemo(() => {
    if (!['collecting', 'lock_grace', 'deciding'].includes(party?.round?.phase)) return null;
    const deadline = party?.round?.phase === 'deciding'
      ? party.round.decision?.deadlineAt
      : party?.round?.phase === 'lock_grace' ? party.round.lockAt : party?.round?.deadlineAt;
    if (!deadline) return null;
    return Math.max(0, Math.ceil((deadline - (clock + serverOffset)) / 1000));
  }, [party?.round, clock, serverOffset]);

  async function act(key, operation) {
    setBusy(key);
    setError('');
    try {
      const result = await operation();
      applySnapshot(result);
      if (fetchingRef.current) await fetchingRef.current;
      await refresh();
    } catch (e) {
      if (e.status === 409) {
        if (fetchingRef.current) await fetchingRef.current;
        await refresh();
      }
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function shareAction(ready = false) {
    const result = await submitPartyIntent(sessionId, {
      text: actionText,
      roundId: party.round.id,
      commandId: commandId('intent'),
      ...(ready ? { ready: true } : {}),
    });
    lastSubmittedRef.current = actionText;
    setDraftNotice('');
    return result;
  }

  function typingHeartbeat() {
    const timestamp = Date.now();
    if (timestamp - typingAtRef.current < 2000) return;
    typingAtRef.current = timestamp;
    heartbeatPartyTyping(sessionId).catch(() => {});
  }

  async function createInvite() {
    await act('invite', async () => {
      const invite = await createPartyInvite(sessionId);
      const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      setInviteUrl(`${base}#/party/${encodeURIComponent(sessionId)}/join/${encodeURIComponent(invite.inviteToken)}`);
    });
  }

  if (!party) {
    return (
      <div>
        <FocusHeader showLogin title="Party Session" steps={[]} currentStep={0} exitLabel="ホーム" onExit={() => navigate({ name: 'home' })} />
        <div style={{ padding: 48, textAlign: 'center', fontFamily: F_MONO, color: error || syncError ? COLORS.stamp : COLORS.faint }}>
          {error || syncError || 'Partyへ接続中…'}
        </div>
      </div>
    );
  }

  const phase = party.round?.phase || 'lobby';
  const lobby = party.status === 'lobby';
  const away = myParticipant?.activity === 'away_manual' || myParticipant?.activity === 'away_auto';
  const host = party.me.role === 'host';
  const ownPc = party.pcs.find((pc) => pc.id === party.me.pcId);
  const narratives = party.snapshot?.narratives || [];
  const pcState = party.snapshot?.pcs?.[party.me.pcId];
  const collecting = ['collecting', 'lock_grace'].includes(phase);
  const progressLabel = party.round?.progress === 'narrating' ? '判定完了・あなたの場面を描写中…' : '全員の行動を一度に解決中…';
  const choices = party.snapshot?.choicesByPc?.[party.me.pcId] || [];

  const partyPanel = (
    <Card>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, marginBottom: 10 }}>Party</div>
      <ParticipantList party={party} />
      {!lobby && (
        <div style={{ marginTop: 12 }}>
          {away ? (
            <Button variant="brass" onClick={() => act('return', () => returnToParty(sessionId))} disabled={!!busy}>参加に戻る</Button>
          ) : (
            <Button variant="ghost" onClick={() => act('away', () => setPartyAway(sessionId, { policy: myParticipant.awayPolicy }))} disabled={!!busy}>離席</Button>
          )}
        </div>
      )}
      {host && party.status !== 'ended' && (
        <label style={{ display: 'block', fontFamily: F_BODY, fontSize: 12, marginTop: 12 }}>
          行動時間
          <select aria-label="行動時間" value={party.settings.actionTimeoutSeconds || 0} disabled={!!busy} onChange={(e) => act('settings', () => updatePartySettings(sessionId, { actionTimeoutSeconds: Number(e.target.value) }))} style={{ ...inputStyle, marginTop: 4 }}>
            <option value={0}>無制限</option>
            {Array.from(new Set([party.settings.actionTimeoutSeconds, 180, 300, 600])).filter(Boolean).sort((a, b) => a - b).map((seconds) => <option key={seconds} value={seconds}>{seconds}秒</option>)}
          </select>
        </label>
      )}
      {host && !lobby && party.status !== 'ended' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {phase === 'paused' ? (
            <Button variant="ghost" onClick={() => act('resume', () => hostResumeParty(sessionId))} disabled={!!busy}>再開</Button>
          ) : (
            <Button variant="ghost" onClick={() => act('pause', () => hostPauseParty(sessionId))} disabled={!!busy || phase === 'resolving'}>停止</Button>
          )}
          {['collecting', 'lock_grace', 'deciding'].includes(phase) && (
            <Button variant="ghost" onClick={() => act('advance', () => hostAdvanceParty(sessionId))} disabled={!!busy}>先へ進む</Button>
          )}
          <Button variant="ghost" onClick={() => setEndConfirm(true)} disabled={!!busy}>終了</Button>
        </div>
      )}
    </Card>
  );

  const characterPanel = (
    <Card>
      <h2 style={{ fontFamily: F_DISPLAY, fontSize: 14, margin: '0 0 10px' }}>旅の目的</h2>
      <div style={{ fontFamily: F_BODY, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
        <strong>共通の目的</strong><p>{party.sharedGoal || '導入で提示される。'}</p>
        <strong>あなたの目的</strong><p>{ownPc?.goal || '導入で提示される。'}</p>
      </div>
      {ownPc && <details style={{ fontFamily: F_BODY, fontSize: 13 }}>
        <summary style={{ cursor: 'pointer', padding: '10px 0', color: COLORS.brassDark }}>キャラクターシート：{ownPc.characterName}</summary>
        {Object.entries(pcState?.resources || {}).map(([key, resource]) => <div key={key}>{key}: {resource.value} / {resource.max}</div>)}
        {pcState?.conditions?.length > 0 && <p>状態：{pcState.conditions.join('、')}</p>}
        {ownPc.bonds && <p style={{ whiteSpace: 'pre-wrap' }}>関係：{ownPc.bonds}</p>}
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8 }}>{ownPc.raw || 'シート未登録'}</div>
      </details>}
    </Card>
  );

  const progressPanel = (
    <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${COLORS.line}`, fontFamily: F_BODY, fontSize: 13 }}>
      <div role="status" aria-live="polite">
        {phase === 'resolving' ? progressLabel : PHASE_LABELS[phase] || phase}
      </div>
      {phase === 'resolving' && party.round.resolutionStartedAt && <div style={{ color: COLORS.inkSoft, marginTop: 5 }}>
        経過 {Math.max(0, Math.floor((clock + serverOffset - party.round.resolutionStartedAt) / 1000))}秒
      </div>}
      {collecting && remaining === null && <p>時間制限なし。全員が行動を確定すると進む。</p>}
      {remaining !== null && <div style={{ color: COLORS.inkSoft, marginTop: 5 }}>
        {remaining === 0 ? '進行状態を同期中…' : phase === 'lock_grace' ? '全員確定。まもなく進む。' : `残り ${Math.ceil(remaining / 60)}分`}
      </div>}
      {party.round?.error && <p role="alert" style={{ color: COLORS.stamp }}>{party.round.error}</p>}
      {phase === 'paused' && party.round?.resolutionId && <div style={{ fontFamily: F_MONO, fontSize: 10 }}>問い合わせID: {party.round.resolutionId}</div>}
    </div>
  );

  const storyPanel = (
    <Card style={{ minHeight: 420 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink }}>{party.title}</div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>{ownPc?.characterName || 'PC未選択'}視点</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {narratives.map((item, index) => (
          <div key={item.id} ref={index === narratives.length - 1 ? latestStoryRef : null} tabIndex={index === narratives.length - 1 ? -1 : undefined} style={{ scrollMarginTop: 80, borderLeft: `3px solid ${COLORS.brass}`, padding: '4px 0 4px 12', whiteSpace: 'pre-wrap', fontFamily: F_BODY, fontSize: 15, lineHeight: 1.8, color: COLORS.inkSoft }}>
            {item.text}
          </div>
        ))}
        {narratives.length === 0 && <div style={{ fontFamily: F_BODY, color: COLORS.faint }}>物語は開始待ち。</div>}
      </div>
      {progressPanel}
    </Card>
  );

  const actionPanel = (
    <Card>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, marginBottom: 10 }}>行動</div>
      {mobile && progressPanel}
      {phase === 'deciding' && party.round.decision && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: F_BODY, fontWeight: 600, marginBottom: 8 }}>{party.round.decision.question}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {party.round.decision.options.map((option) => (
              <Button key={option.id} variant={party.round.decision.votes?.[party.me.userId] === option.id ? 'brass' : 'ghost'} onClick={() => act(`vote:${option.id}`, () => voteParty(sessionId, option.id))} disabled={!!busy || away}>
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {collecting && !away && (
        <>
          {choices.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {choices.map((choice) => <Button key={choice} disabled={isReady || !!busy} variant="ghost" onClick={() => setActionText(choice)}>{choice}</Button>)}
            </div>
          )}
          {draftNotice && <p style={{ fontFamily: F_BODY, fontSize: 12 }}>{draftNotice}</p>}
          <textarea
            aria-label="自分の行動"
            disabled={isReady || !!busy}
            value={actionText}
            onChange={(e) => { setActionText(e.target.value); typingHeartbeat(); }}
            onKeyDown={(e) => {
              if (e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key)) typingHeartbeat();
            }}
            onCompositionUpdate={typingHeartbeat}
            rows={5}
            placeholder="このPCが何をするか"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
            <Button variant="primary" onClick={() => act('intent', () => shareAction())} disabled={!!busy || !actionText.trim() || isReady}>
              {myIntent ? '行動を更新' : '行動を共有'}
            </Button>
            {myIntent && !isReady && <Button variant="ghost" onClick={() => act('delete-intent', () => deletePartyIntent(sessionId, myIntent.id))} disabled={!!busy}>撤回</Button>}
          </div>
          {(myIntent || actionText.trim()) && (
            <Button variant={isReady ? 'ghost' : 'brass'} onClick={() => act('ready', () => isReady ? unreadyParty(sessionId, party.round.id) : shareAction(true))} disabled={!!busy} style={{ marginTop: 8 }}>
              {isReady ? '確定を取り消す' : 'この行動で確定'}
            </Button>
          )}
        </>
      )}
      <div style={{ marginTop: 16, borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
        <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginBottom: 7 }}>共有済み行動</div>
        {(party.round?.intents || []).map((intent) => (
          <div key={intent.id} style={{ fontFamily: F_BODY, fontSize: 12, marginBottom: 6 }}>
            <strong>{intent.characterName}</strong>: {intent.text}
          </div>
        ))}
      </div>
    </Card>
  );

  const chatPanel = (
    <Card>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, marginBottom: 8 }}>チャット</div>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {chat.map((message) => (
          <div key={message.id} style={{ fontFamily: F_BODY, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            <strong>{message.displayName}</strong>: {message.text}
          </div>
        ))}
      </div>
      <textarea aria-label="Partyチャット" value={chatText} onChange={(e) => setChatText(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      <Button variant="ghost" onClick={() => act('chat', async () => { await sendPartyChat(sessionId, chatText, commandId('chat')); setChatText(''); })} disabled={!!busy || !chatText.trim()} style={{ marginTop: 7 }}>送信</Button>
      <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 6 }}>相談内容はAI GMへ送られない。</div>
    </Card>
  );

  return (
    <div>
      <FocusHeader showLogin title={party.title} steps={[]} currentStep={0} exitLabel="ホーム" onExit={() => navigate({ name: 'home' })} />
      <div style={{ padding: mobile ? '14px 10px 80px' : '22px', maxWidth: 1500, margin: '0 auto' }}>
        {syncError && <div role="status" style={{ color: COLORS.stamp, fontFamily: F_BODY }}>{syncError}</div>}
        {error && <div role="alert" style={{ color: COLORS.stamp, fontFamily: F_BODY, marginBottom: 10 }}>{error}</div>}

        {lobby ? (
          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {partyPanel}
            {characterPanel}
            <Card>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 16, marginBottom: 10 }}>担当PCを選ぶ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {party.pcs.map((pc) => {
                  const owner = party.participants.find((item) => item.pcId === pc.id);
                  return (
                    <Button key={pc.id} variant={party.me.pcId === pc.id ? 'brass' : 'ghost'} onClick={() => act(`claim:${pc.id}`, () => claimPartyPc(sessionId, pc.id))} disabled={!!busy || (!!owner && owner.userId !== party.me.userId)}>
                      {pc.characterName}{owner ? ` — ${owner.displayName}` : ''}
                    </Button>
                  );
                })}
              </div>
              {party.me.pcId && (
                <Button variant={myParticipant.lobbyReady ? 'ghost' : 'brass'} onClick={() => act('lobby-ready', () => myParticipant.lobbyReady ? unreadyParty(sessionId) : readyParty(sessionId))} disabled={!!busy} style={{ marginTop: 12 }}>
                  {myParticipant.lobbyReady ? '準備完了を取り消す' : '準備完了'}
                </Button>
              )}
            </Card>
            {host && (
              <Card>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="ghost" onClick={createInvite} disabled={!!busy}>{busy === 'invite' ? '発行中…' : '招待URLを発行'}</Button>
                  <Button variant="brass" onClick={() => act('start', () => startPartySession(sessionId))} disabled={!!busy || party.participants.length < 2 || party.participants.some((item) => !item.pcId || !item.lobbyReady)}>
                    {busy === 'start' ? '導入生成中…' : 'セッション開始'}
                  </Button>
                </div>
                {inviteUrl && <input aria-label="招待URL" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} style={{ ...inputStyle, marginTop: 10 }} />}
              </Card>
            )}
          </div>
        ) : mobile ? (
          <>
            <div style={{ display: mobileTab === 'story' ? 'block' : 'none' }}>{storyPanel}</div>
            <div style={{ display: mobileTab === 'action' ? 'block' : 'none' }}>{actionPanel}</div>
            <div style={{ display: mobileTab === 'party' ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>{partyPanel}{characterPanel}{chatPanel}</div>
            <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: COLORS.card, borderTop: `1px solid ${COLORS.lineStrong}`, padding: 8, display: 'flex', justifyContent: 'center', gap: 7, zIndex: 5 }}>
              {['story', 'action', 'party'].map((tab) => <Button key={tab} variant={mobileTab === tab ? 'brass' : 'ghost'} onClick={() => { setMobileTab(tab); if (tab !== 'story') window.scrollTo({ top: 0 }); }}>{tab === 'story' ? '物語' : tab === 'action' ? '行動' : 'Party'}</Button>)}
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(380px, 1fr) 330px', gap: 14, alignItems: 'start' }}>
            {partyPanel}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{storyPanel}{actionPanel}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{characterPanel}{chatPanel}</div>
          </div>
        )}

        {party.status === 'ended' && (
          <div style={{ textAlign: 'center', marginTop: 18 }}><Button variant="brass" onClick={() => navigate({ name: 'home' })}>ホームへ戻る</Button></div>
        )}
      </div>
      {!lobby && narratives.length > 0 && (!mobile || mobileTab === 'story') && <Button variant="brass" style={{ position: 'fixed', right: mobile ? 16 : undefined, left: mobile ? undefined : 16, bottom: mobile ? 70 : 18, zIndex: 6 }} onClick={() => { setMobileTab('story'); requestAnimationFrame(() => { latestStoryRef.current?.scrollIntoView({ block: 'start' }); latestStoryRef.current?.focus({ preventScroll: true }); }); }}>最新の場面へ</Button>}
      <ConfirmModal
        open={endConfirm}
        message="このPartyセッションを終了する。全員の画面で再開不能になる。よいか?"
        confirmLabel="終了する"
        confirmDisabled={!!busy}
        onCancel={() => setEndConfirm(false)}
        onConfirm={() => act('end', async () => { await hostEndParty(sessionId); setEndConfirm(false); })}
      />
    </div>
  );
}
