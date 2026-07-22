import { COLORS, F_BODY } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';

export default function ConfirmModal({ open, message, confirmDisabled, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31,42,56,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <Card style={{ maxWidth: 360, width: '90%' }}>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.ink, marginBottom: 20 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="brass" onClick={onConfirm} disabled={confirmDisabled}>
            削除する
          </Button>
        </div>
      </Card>
    </div>
  );
}
