import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import { importWorld, importCharacter, importScenario } from '../../api/shareClient.js';
import { listWorlds } from '../../api/worldLibraryClient.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { KIND_LABELS } from '../../constants/publicContent.js';

export const authorButtonStyle = {
  font: 'inherit',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  color: 'inherit',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
};

export function formatPublicDate(item) {
  return new Date(item.publishedAt).toLocaleDateString('ja-JP');
}

export function publicMetaLine(item) {
  return `${item.ownerName} ・ ${formatPublicDate(item)}`;
}

export default function PublicItemDetail({ type, item, onBack, onAuthorClick }) {
  const { user } = useAuth();

  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState('');
  const [addError, setAddError] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWorlds, setPickerWorlds] = useState([]);
  const [pickerError, setPickerError] = useState('');

  async function handleAddWorld() {
    setAdding(true);
    setAddError('');
    setAddMessage('');
    try {
      await importWorld(item.publicId);
      setAddMessage('ライブラリに追加しました');
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function openPicker() {
    setAddError('');
    setAddMessage('');
    setPickerError('');
    try {
      setPickerWorlds(await listWorlds());
      setPickerOpen(true);
    } catch (e) {
      setPickerError('World一覧の取得に失敗した: ' + e.message);
      setPickerOpen(true);
    }
  }

  async function handlePick(worldId) {
    setAdding(true);
    setAddError('');
    try {
      if (type === 'characters') {
        await importCharacter(item.publicId, worldId);
      } else {
        await importScenario(item.publicId, worldId);
      }
      setAddMessage('ライブラリに追加しました');
      setPickerOpen(false);
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <Button variant="ghost" onClick={onBack} style={{ marginBottom: 16 }}>
        ← 一覧に戻る
      </Button>

      <Card>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink, marginBottom: 6 }}>{item.title}</div>
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginBottom: 4 }}>
          {onAuthorClick ? (
            <button type="button" onClick={() => onAuthorClick(item.ownerId)} style={authorButtonStyle}>
              {item.ownerName}
            </button>
          ) : (
            <span>{item.ownerName}</span>
          )}
          {` ・ ${formatPublicDate(item)}`}
        </div>
        {type === 'characters' && (
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
            {KIND_LABELS[item.kind] || item.kind}
          </div>
        )}
        {type === 'scenarios' && item.recommendedRuleset && (
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
            推奨ルール: {item.recommendedRuleset}
          </div>
        )}

        <div
          style={{
            fontFamily: F_BODY,
            fontSize: 14,
            color: COLORS.inkSoft,
            whiteSpace: 'pre-wrap',
            marginBottom: 16,
          }}
        >
          {item.raw}
        </div>

        {type === 'worlds' && (
          <>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 8 }}>
              地域(region)
            </div>
            {(item.regions || []).map((r) => (
              <div key={r.name} style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 4 }}>
                  {r.name}
                </div>
                <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, whiteSpace: 'pre-wrap' }}>
                  {r.raw}
                </div>
              </div>
            ))}
            {(item.regions || []).length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint, marginBottom: 8 }}>
                地域は無い。
              </div>
            )}

            <div
              style={{
                fontFamily: F_DISPLAY,
                fontSize: 13,
                color: COLORS.brassDark,
                marginBottom: 8,
                marginTop: 12,
              }}
            >
              カテゴリ(category)
            </div>
            {(item.categories || []).map((c) => (
              <div key={c.name} style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 4 }}>
                  {c.name}
                </div>
                <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, whiteSpace: 'pre-wrap' }}>
                  {c.raw}
                </div>
              </div>
            ))}
            {(item.categories || []).length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint }}>カテゴリは無い。</div>
            )}
          </>
        )}
      </Card>

      {type !== 'novels' && (
        <div style={{ marginTop: 16 }}>
          {!user ? (
            <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
              追加にはログインが必要です(右上からログイン)
            </div>
          ) : (
            <>
              <Button variant="brass" onClick={type === 'worlds' ? handleAddWorld : openPicker} disabled={adding}>
                {adding ? '追加中…' : 'ライブラリに追加'}
              </Button>
              {addMessage && (
                <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginTop: 8 }}>
                  {addMessage}
                </div>
              )}
              {addError && (
                <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.stamp, marginTop: 8 }}>{addError}</div>
              )}
            </>
          )}
        </div>
      )}

      {pickerOpen && (
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
            <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink, marginBottom: 16 }}>
              追加先のWorldを選択
            </div>
            {pickerError && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{pickerError}</div>}
            {!pickerError && pickerWorlds.length === 0 ? (
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 16 }}>
                先に世界観を作成してください
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {pickerWorlds.map((w) => (
                  <Card key={w.id} onClick={() => handlePick(w.id)} style={{ cursor: 'pointer' }}>
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{w.title}</div>
                  </Card>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setPickerOpen(false)}>
                キャンセル
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
