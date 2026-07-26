import { useState, useEffect, useRef } from 'react';
import { COLORS, F_MONO, F_BODY, F_DISPLAY, inputStyle } from '../../theme.js';
import Button from '../ui/Button.jsx';
import Field from '../ui/Field.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { patchMe } from '../../api/authClient.js';
import { navigate } from '../../navigation/useRoute.js';
import LoginModal from '../auth/LoginModal.jsx';

const menuItemStyle = {
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontFamily: F_BODY,
  fontSize: 13,
  color: COLORS.ink,
  padding: '6px 8px',
  borderRadius: 4,
};

export default function AccountMenu() {
  const { user, loading, refresh, logout } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menuOpen]);

  if (loading) return null;

  // シェルのヘッダー内に置くため浮かせない(旧AuthBarはposition:fixedで本文と無関係に浮いていた)。
  const wrapStyle = { position: 'relative' };

  if (!user) {
    return (
      <div style={wrapStyle}>
        <Button variant="brass" onClick={() => setLoginOpen(true)}>
          ログイン
        </Button>
        {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      </div>
    );
  }

  return (
    <div style={{ ...wrapStyle, textAlign: 'right' }}>
      <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            // 固定配置なので、スクロールした本文がこの下を通り抜ける。透明のままだと
            // ユーザー名とカードの文字が重なって読めなくなるため、紙色で背景を塗る。
            background: COLORS.paper,
            borderRadius: 999,
            padding: '4px 10px 4px 4px',
            border: `1px solid ${COLORS.lineStrong}`,
            fontFamily: F_MONO,
            fontSize: 13,
            color: COLORS.ink,
          }}
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: COLORS.brass,
                color: COLORS.paper,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: F_DISPLAY,
                fontSize: 13,
              }}
            >
              {(user.displayName || '?').slice(0, 1)}
            </div>
          )}
          <span>{user.displayName}</span>
        </button>
        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 8,
              background: COLORS.paper,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 6,
              padding: 8,
              minWidth: 160,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              textAlign: 'left',
            }}
          >
            <button
              type="button"
              style={menuItemStyle}
              onClick={() => {
                setMenuOpen(false);
                navigate({ name: 'user', userId: user.id });
              }}
            >
              自分のページ
            </button>
            <button
              type="button"
              style={menuItemStyle}
              onClick={() => {
                setMenuOpen(false);
                setEditOpen(true);
              }}
            >
              プロフィール編集
            </button>
            <button
              type="button"
              style={menuItemStyle}
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            >
              ログアウト
            </button>
          </div>
        )}
      </div>
      {editOpen && (
        <ProfileEditModal
          user={user}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            await refresh();
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ProfileEditModal({ user, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [clearAvatar, setClearAvatar] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const patch = { displayName, bio };
      if (clearAvatar) patch.avatarUrl = null;
      await patchMe(patch);
      await onSaved();
    } catch (e) {
      setError(e.message || '保存に失敗しました');
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.paper, borderRadius: 8, padding: 24, minWidth: 280 }}
      >
        <div style={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink, marginBottom: 12 }}>
          プロフィール編集
        </div>
        <Field label="表示名">
          <input
            style={inputStyle}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field label="自己紹介" hint="他のユーザーの公開ページに表示される(最大500文字)">
          <textarea
            style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </Field>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: F_BODY,
            fontSize: 13,
            color: COLORS.inkSoft,
            marginBottom: 16,
          }}
        >
          <input
            type="checkbox"
            checked={clearAvatar}
            onChange={(e) => setClearAvatar(e.target.checked)}
          />
          アバターを削除する
        </label>
        {error && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="brass" onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
