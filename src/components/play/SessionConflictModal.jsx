import Modal from '../ui/Modal.jsx';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import { COLORS, F_BODY, F_DISPLAY, F_MONO } from '../../theme.js';

function turnCount(session) {
  return Number.isFinite(session?.state?.turn_count) ? session.state.turn_count : 0;
}

export default function SessionConflictModal({
  conflict,
  busy = false,
  error = '',
  onUseRemote,
  onOverwrite,
}) {
  if (!conflict) return null;
  const concurrent = conflict.reason === 'write-conflict' || conflict.reason === 'remote-update';

  return (
    <Modal
      open
      onClose={() => {}}
      title="別端末の進捗を検出"
      zIndex={1200}
      titleStyle={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink, margin: '0 0 12px' }}
      panelStyle={{ maxWidth: 480, width: '92%' }}
    >
      <Card>
        <p style={{ fontFamily: F_BODY, fontSize: 14, lineHeight: 1.7, color: COLORS.ink, margin: '0 0 14px' }}>
          {concurrent
            ? '同じセッションが別端末で更新された。この端末の内容で上書きすると、別端末の進捗が失われる。'
            : 'ログイン先に別進捗が保存されている。残す進捗を選択。'}
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            fontFamily: F_MONO,
            fontSize: 11,
            color: COLORS.inkSoft,
            marginBottom: 16,
          }}
        >
          <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: 10 }}>
            この端末
            <div style={{ color: COLORS.ink, marginTop: 4 }}>ターン {turnCount(conflict.local)}</div>
          </div>
          <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: 10 }}>
            別端末
            <div style={{ color: COLORS.ink, marginTop: 4 }}>ターン {turnCount(conflict.remote)}</div>
          </div>
        </div>
        {error && (
          <div role="alert" style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.stamp, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="ghost" onClick={onUseRemote} disabled={busy}>
            別端末の進捗を使う
          </Button>
          <Button variant="brass" onClick={onOverwrite} disabled={busy}>
            この端末で上書き
          </Button>
        </div>
      </Card>
    </Modal>
  );
}
