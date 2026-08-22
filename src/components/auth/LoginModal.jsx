import { useEffect, useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY } from '../../theme.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import { fetchProviders, loginUrl, startIdentityLink } from '../../api/authClient.js';

const LABELS = { google: 'Google', discord: 'Discord', x: 'X' };

export default function LoginModal({ onClose, mode = 'login' }) {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProviders()
      .then(({ providers: p }) => setProviders(p))
      .catch(() => setProviders([]));
  }, []);

  async function chooseProvider(provider) {
    setError('');
    try {
      if (mode === 'link') {
        const { url } = await startIdentityLink(provider);
        window.location.assign(url);
        return;
      }
      window.location.assign(loginUrl(provider));
    } catch (reason) {
      setError(reason.message || 'ログイン方法の追加に失敗しました');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'link' ? 'ログイン方法を追加' : 'ログイン'}
      titleStyle={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink, margin: '0 0 12px' }}
      panelStyle={{ background: COLORS.paper, borderRadius: 8, padding: 24, minWidth: 280 }}
    >
      <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, marginBottom: 16 }}>
        {mode === 'link'
          ? '選択したログイン方法を、現在のアカウントへ追加します。'
          : 'プレイの進行・素材ライブラリ・小説化にはログインが必要です。メールアドレスは取得しません。'}
      </div>
      {providers === null && <div style={{ fontFamily: F_BODY, fontSize: 13 }}>読み込み中…</div>}
      {providers?.length === 0 && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp }}>ログイン方法が設定されていません</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(providers || []).map((p) => (
          <Button key={p} variant="brass" onClick={() => chooseProvider(p)}>
            {LABELS[p] || p}{mode === 'link' ? ' を追加' : ' でログイン'}
          </Button>
        ))}
      </div>
      {error && <div style={{ marginTop: 12, fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp }}>{error}</div>}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </Modal>
  );
}
