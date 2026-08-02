import { useState } from 'react';
import { COLORS, F_BODY, F_DISPLAY } from '../theme.js';
import { joinPartySession } from '../api/partyClient.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import FocusHeader from '../components/nav/FocusHeader.jsx';
import { navigate, replace } from '../navigation/useRoute.js';

export default function PartyJoin({ sessionId, inviteToken }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function join() {
    setBusy(true);
    setError('');
    try {
      await joinPartySession(sessionId, inviteToken);
      replace({ name: 'party', sessionId });
    } catch (e) {
      setError('参加に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <FocusHeader title="Party招待" steps={['招待', 'PC選択', '準備', '開始']} currentStep={0} exitLabel="戻る" onExit={() => navigate({ name: 'home' })} />
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '52px 20px' }}>
        <Card style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink, marginBottom: 10 }}>
            同じ物語へ参加する
          </div>
          <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, marginBottom: 20 }}>
            参加後、空いているPCを選び、全員の準備完了を待つ。
          </div>
          {error && <div style={{ color: COLORS.stamp, fontFamily: F_BODY, fontSize: 13, marginBottom: 14 }}>{error}</div>}
          <Button variant="brass" onClick={join} disabled={busy || !inviteToken}>
            {busy ? '参加中…' : '招待に参加'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
