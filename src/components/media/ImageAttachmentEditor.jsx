import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, F_BODY, F_DISPLAY, F_MONO, inputStyle } from '../../theme.js';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../library/ConfirmModal.jsx';
import {
  attachmentBase,
  attachmentUrl,
  deleteAttachment,
  getAttachments,
  setTopAttachment,
  updateAttachment,
  uploadAttachment,
} from '../../api/attachmentClient.js';

const EMPTY = { schemaVersion: 1, topImageId: null, items: [], updatedAt: null };

function AttachmentRow({ owner, item, isTop, busy, onSave, onTop, onDelete }) {
  const [description, setDescription] = useState(item.description || '');

  useEffect(() => {
    setDescription(item.description || '');
  }, [item.id, item.description]);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        padding: 12,
        border: `1px solid ${isTop ? COLORS.brass : COLORS.line}`,
        borderRadius: 6,
        background: COLORS.paper,
      }}
    >
      <img
        src={attachmentUrl(owner, item.id, 'thumbnail')}
        alt={item.description || '添付画像'}
        style={{
          width: 180,
          maxWidth: '100%',
          aspectRatio: '16 / 9',
          objectFit: 'cover',
          borderRadius: 4,
          flex: '0 1 180px',
        }}
      />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        {isTop && (
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, marginBottom: 6 }}>
            トップ画像
          </div>
        )}
        <textarea
          aria-label="画像の説明"
          value={description}
          maxLength={500}
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
        />
        <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, margin: '4px 0 8px' }}>
          {description.length}/500
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button
            variant="ghost"
            disabled={busy || description.trim() === (item.description || '')}
            onClick={() => onSave(item.id, description)}
          >
            説明を保存
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => onTop(isTop ? null : item.id)}>
            {isTop ? 'トップ解除' : 'トップ画像にする'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => onDelete(item)}>
            画像を削除
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ImageAttachmentEditor({ owner, onCollectionChange }) {
  const ownerKey = useMemo(() => attachmentBase(owner), [owner]);
  const [collection, setCollection] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const fileRef = useRef(null);

  function applyCollection(next, notify = true) {
    setCollection(next);
    if (notify) onCollectionChange?.(next);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getAttachments(owner)
      .then((next) => {
        if (!cancelled) applyCollection(next, false);
      })
      .catch((e) => {
        if (!cancelled) setError('画像の取得に失敗した: ' + e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // ownerKey is stable serialization of owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  async function handleFiles(event) {
    const files = [...(event.target.files || [])];
    if (files.length === 0) return;
    setBusy(true);
    setError('');
    const failures = [];
    let latest = collection;
    for (const file of files) {
      try {
        const result = await uploadAttachment(owner, file);
        latest = result.collection;
        applyCollection(latest);
      } catch (e) {
        failures.push(`${file.name}: ${e.message}`);
      }
    }
    if (failures.length > 0) setError(failures.join('\n'));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSave(id, description) {
    setBusy(true);
    setError('');
    try {
      const result = await updateAttachment(owner, id, description);
      applyCollection(result.collection);
    } catch (e) {
      setError('説明の保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTop(imageId) {
    setBusy(true);
    setError('');
    try {
      applyCollection(await setTopAttachment(owner, imageId));
    } catch (e) {
      setError('トップ画像の変更に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError('');
    try {
      await deleteAttachment(owner, deleteTarget.id);
      applyCollection({
        ...collection,
        topImageId: collection.topImageId === deleteTarget.id ? null : collection.topImageId,
        items: collection.items.filter((item) => item.id !== deleteTarget.id),
      });
      setDeleteTarget(null);
    } catch (e) {
      setError('画像の削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${COLORS.line}` }}>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark, marginBottom: 6 }}>
        画像
      </div>
      <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint, marginBottom: 10 }}>
        JPEG・PNG・WebP、1枚10MBまで、最大20枚。説明は公開時にも表示される。
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy || collection.items.length >= 20}
        onChange={handleFiles}
        aria-label="画像を追加"
      />
      {busy && (
        <div role="status" style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginTop: 8 }}>
          処理中…
        </div>
      )}
      {error && (
        <div style={{ whiteSpace: 'pre-wrap', color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{error}</div>
      )}
      {loading ? (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginTop: 12 }}>読み込み中…</div>
      ) : collection.items.length === 0 ? (
        <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint, marginTop: 12 }}>
          添付画像なし
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {collection.items.map((item) => (
            <AttachmentRow
              key={item.id}
              owner={owner}
              item={item}
              isTop={collection.topImageId === item.id}
              busy={busy}
              onSave={handleSave}
              onTop={handleTop}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}
      <ConfirmModal
        open={deleteTarget !== null}
        message="この画像を削除する。公開済みスナップショットは再公開まで変わらない。"
        confirmLabel="削除"
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
