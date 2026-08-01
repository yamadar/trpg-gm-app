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
  const mobile = useMediaQuery('(max-width: 820px)');
  const [party, setParty] = useState(null);
  const [chat, setChat] = useState([]);
  const [actionText, setActionText] = useState('');
  const [chatText, setChatText] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [endConfirm, setEndConfirm] = useState(false);
  const [mobileTab, setMobileTab] = useState('story');
  const fetchingRef = useRef(false);
  const typingAtRef = useRef(0);
  const roundRef = useRef(null);
  const chatSeqRef = useRef(0);
  const chatInitializedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [snapshot, messages] = await Promise.all([
        getPartySnapshot(sessionId),
        getPartyChat(sessionId, chatSeqRef.current),
      ]);
      setParty(snapshot);
      if (Number.isFinite(snapshot.serverNow)) setServerOffset(snapshot.serverNow - Date.now());
      const incoming = Array.isArray(messages.messages) ? messages.messages : [];
      const initialChat = !chatInitializedRef.current;
      if (initialChat || incoming.length > 0) {
        setChat((current) => {
          if (initialChat) return incoming.slice(-MAX_VISIBLE_CHAT_MESSAGES);
          const known = new Set(current.map((message) => message.id));
          return [...current, ...incoming.filter((message) => !known.has(message.id))]
            .slice(-MAX_VISIBLE_CHAT_MESSAGES);
        });
      }
      const highestIncomingSeq = incoming.reduce(
        (highest, message) => Number.isSafeInteger(message.seq) ? Math.max(highest, message.seq) : highest,
        chatSeqRef.current,
      );
      chatSeqRef.current = Number.isSafeInteger(messages.nextSeq)
        ? Math.max(highestIncomingSeq, messages.nextSeq)
        : highestIncomingSeq;
      chatInitializedRef.current = true;
      setError('');
    } catch (e) {
      setError('Party状態の取得に失敗した: ' + e.message);
    } finally {
      fetchingRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 1000);
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => {
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
      setActionText(myIntent?.text || '');
    }
  }, [party?.round?.id, myIntent?.text]);

  const remaining = useMemo(() => {
    const deadline = party?.round?.phase === 'deciding'
      ? party.round.decision?.deadlineAt
      : party?.round?.lockAt || party?.round?.deadlineAt;
    if (!deadline) return null;
    return Math.max(0, Math.ceil((deadline - (clock + serverOffset)) / 1000));
  }, [party?.round, clock, serverOffset]);

  async function act(key, operation) {
    setBusy(key);
    setError('');
    try {
      await operation();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
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
        <FocusHeader title="Party Session" steps={[]} currentStep={0} exitLabel="ホーム" onExit={() => navigate({ name: 'home' })} />
        <div style={{ padding: 48, textAlign: 'center', fontFamily: F_MONO, color: error ? COLORS.stamp : COLORS.faint }}>
          {error || 'Partyへ接続中…'}
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
      {host && !lobby && party.status !== 'ended' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {phase === 'paused' ? (
            <Button variant="ghost" onClick={() => act('resume', () => hostResumeParty(sessionId))} disabled={!!busy}>再開</Button>
          ) : (
            <Button variant="ghost" onClick={() => act('pause', () => hostPauseParty(sessionId))} disabled={!!busy}>停止</Button>
          )}
          {['collecting', 'lock_grace', 'deciding'].includes(phase) && (
            <Button variant="ghost" onClick={() => act('advance', () => hostAdvanceParty(sessionId))} disabled={!!busy}>先へ進む</Button>
          )}
          <Button variant="ghost" onClick={() => setEndConfirm(true)} disabled={!!busy}>終了</Button>
        </div>
      )}
    </Card>
  );

  const storyPanel = (
    <Card style={{ minHeight: 420 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink }}>{party.title}</div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>{ownPc?.characterName || 'PC未選択'}視点</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Badge>{PHASE_LABELS[phase] || phase}</Badge>
          {remaining !== null && <div style={{ fontFamily: F_MONO, color: remaining <= 10 ? COLORS.stamp : COLORS.brassDark, marginTop: 5 }}>{remaining}秒</div>}
        </div>
      </div>
      {phase === 'resolving' && <div style={{ fontFamily: F_BODY, color: COLORS.brassDark, marginBottom: 12 }}>全員の行動を一度に解決中…</div>}
      {party.round?.error && <div style={{ color: COLORS.stamp, fontFamily: F_BODY, marginBottom: 12 }}>{party.round.error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {narratives.map((item) => (
          <div key={item.id} style={{ borderLeft: `3px solid ${COLORS.brass}`, padding: '4px 0 4px 12', whiteSpace: 'pre-wrap', fontFamily: F_BODY, fontSize: 15, lineHeight: 1.8, color: COLORS.inkSoft }}>
            {item.text}
          </div>
        ))}
        {narratives.length === 0 && <div style={{ fontFamily: F_BODY, color: COLORS.faint }}>物語は開始待ち。</div>}
      </div>
    </Card>
  );

  const actionPanel = (
    <Card>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, marginBottom: 10 }}>行動</div>
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
      {['collecting', 'lock_grace'].includes(phase) && !away && (
        <>
          {choices.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {choices.map((choice) => <Button key={choice} variant="ghost" onClick={() => setActionText(choice)}>{choice}</Button>)}
            </div>
          )}
          <textarea
            aria-label="自分の行動"
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
            <Button variant="primary" onClick={() => act('intent', () => submitPartyIntent(sessionId, { text: actionText, commandId: commandId('intent') }))} disabled={!!busy || !actionText.trim() || isReady}>
              {myIntent ? '行動を更新' : '行動を共有'}
            </Button>
            {myIntent && !isReady && <Button variant="ghost" onClick={() => act('delete-intent', () => deletePartyIntent(sessionId, myIntent.id))} disabled={!!busy}>撤回</Button>}
          </div>
          {myIntent && (
            <Button variant={isReady ? 'ghost' : 'brass'} onClick={() => act('ready', () => isReady ? unreadyParty(sessionId) : readyParty(sessionId))} disabled={!!busy} style={{ marginTop: 8 }}>
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
      <FocusHeader title={party.title} steps={[]} currentStep={0} exitLabel="ホーム" onExit={() => navigate({ name: 'home' })} />
      <div style={{ padding: mobile ? '14px 10px 80px' : '22px', maxWidth: 1500, margin: '0 auto' }}>
        {error && <div style={{ color: COLORS.stamp, fontFamily: F_BODY, marginBottom: 10 }}>{error}</div>}

        {lobby ? (
          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {partyPanel}
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
            <div style={{ display: mobileTab === 'party' ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>{partyPanel}{chatPanel}</div>
            <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: COLORS.card, borderTop: `1px solid ${COLORS.lineStrong}`, padding: 8, display: 'flex', justifyContent: 'center', gap: 7, zIndex: 5 }}>
              {['story', 'action', 'party'].map((tab) => <Button key={tab} variant={mobileTab === tab ? 'brass' : 'ghost'} onClick={() => setMobileTab(tab)}>{tab === 'story' ? '物語' : tab === 'action' ? '行動' : 'Party'}</Button>)}
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(380px, 1fr) 330px', gap: 14, alignItems: 'start' }}>
            {partyPanel}
            {storyPanel}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{actionPanel}{chatPanel}</div>
          </div>
        )}

        {party.status === 'ended' && (
          <div style={{ textAlign: 'center', marginTop: 18 }}><Button variant="brass" onClick={() => navigate({ name: 'home' })}>ホームへ戻る</Button></div>
        )}
      </div>
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
