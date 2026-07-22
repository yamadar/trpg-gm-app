import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getCharacter, putCharacter, listCharacters, deleteCharacter } from '../../api/characterLibraryClient.js';

export default function CharacterTab({ worldId }) {
  const [kind, setKind] = useState('pc');
  const [characters, setCharacters] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRaw, setNewRaw] = useState('');
  const [newRevealed, setNewRevealed] = useState(false);

  const [selectedName, setSelectedName] = useState(null);
  const [editRaw, setEditRaw] = useState('');
  const [editRevealed, setEditRevealed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    if (!worldId) return;
    try {
      setCharacters(await listCharacters(worldId, kind));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    setSelectedName(null);
    setCreating(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, kind]);

  useEffect(() => {
    if (!selectedName) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getCharacter(worldId, kind, selectedName);
        if (cancelled) return;
        setEditRaw(c.raw);
        setEditRevealed(!!c.revealed);
      } catch (e) {
        if (!cancelled) setError('取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      await putCharacter(worldId, kind, newName, {
        raw: newRaw,
        revealed: kind === 'npc' ? newRevealed : undefined,
      });
      setNewName('');
      setNewRaw('');
      setNewRevealed(false);
      setCreating(false);
      await refresh();
    } catch (e) {
      setError('作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await putCharacter(worldId, kind, selectedName, {
        raw: editRaw,
        revealed: kind === 'npc' ? editRevealed : undefined,
      });
      await refresh();
    } catch (e) {
      setError('保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await deleteCharacter(worldId, kind, deleteTarget);
      if (selectedName === deleteTarget) setSelectedName(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!worldId) {
    return (
      <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
        先にWorldタブでWorldを作成・選択してください。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button variant={kind === 'pc' ? 'primary' : 'ghost'} onClick={() => setKind('pc')}>
          PC
        </Button>
        <Button variant={kind === 'npc' ? 'primary' : 'ghost'} onClick={() => setKind('npc')}>
          NPC
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setSelectedName(null);
          }}
        >
          + 新規Character
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {characters.map((c) => (
          <Card
            key={c.name}
            onClick={() => {
              setCreating(false);
              setSelectedName(c.name);
            }}
            style={{ cursor: 'pointer', borderColor: selectedName === c.name ? COLORS.brass : COLORS.line }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{c.name}</div>
              {kind === 'npc' && (
                <span
                  style={{ fontFamily: F_DISPLAY, fontSize: 11, color: c.revealed ? COLORS.brassDark : COLORS.faint }}
                >
                  {c.revealed ? '開示済み' : '未開示'}
                </span>
              )}
            </div>
          </Card>
        ))}
        {characters.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ登録が無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(name)" hint="内部で使う一意なキー(英数字推奨)。本文中の名称とは別。">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: alice" style={inputStyle} />
          </Field>
          <Field label="本文" hint="自由記述。goal/bondsを書いておくとよい。">
            <textarea
              value={newRaw}
              onChange={(e) => setNewRaw(e.target.value)}
              rows={8}
              placeholder="PC/NPCシートの本文"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          {kind === 'npc' && (
            <Field label="開示状態">
              <label style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                <input type="checkbox" checked={newRevealed} onChange={(e) => setNewRevealed(e.target.checked)} />{' '}
                revealed(物語中で開示済み)
              </label>
            </Field>
          )}
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newName}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && selectedName && (
        <Card>
          <Field label="本文">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          {kind === 'npc' && (
            <Field label="開示状態">
              <label style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                <input type="checkbox" checked={editRevealed} onChange={(e) => setEditRevealed(e.target.checked)} />{' '}
                revealed(物語中で開示済み)
              </label>
            </Field>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="brass" onClick={handleSave} disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(selectedName)} disabled={busy}>
              削除
            </Button>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`Character「${deleteTarget}」を削除する。よいか?`}
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
