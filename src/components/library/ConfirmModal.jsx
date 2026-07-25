import { COLORS, F_BODY } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

export default function ConfirmModal({
  open,
  message,
  confirmDisabled,
  confirmLabel = '削除する',
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      // 見出しを持たない確認ダイアログなので、本文そのものをアクセシブル名にする。
      label={message}
      zIndex={1000}
      panelStyle={{ maxWidth: 360, width: '90%' }}
    >
      <Card>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.ink, marginBottom: 20 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="brass" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </Card>
    </Modal>
  );
}
