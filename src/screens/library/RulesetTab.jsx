import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getRuleset, putRuleset, listRulesets, deleteRuleset } from '../../api/rulesetLibraryClient.js';

export default function RulesetTab() {
  const [rulesets, setRulesets] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newGrowthUnit, setNewGrowthUnit] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editHint, setEditHint] = useState('');
  const [editGrowthUnit, setEditGrowthUnit] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    try {
      setRulesets(await listRulesets());
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getRuleset(selectedId);
        if (cancelled) return;
        setEditLabel(r.label);
        setEditDesc(r.desc);
        setEditHint(r.hint || '');
        setEditGrowthUnit(r.growthUnit || '');
      } catch (e) {
        if (!cancelled) setError('取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      await putRuleset(newId, { label: newLabel, desc: newDesc, hint: newHint, growthUnit: newGrowthUnit });
      setNewId('');
      setNewLabel('');
      setNewDesc('');
      setNewHint('');
      setNewGrowthUnit('');
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
      await putRuleset(selectedId, { label: editLabel, desc: editDesc, hint: editHint, growthUnit: editGrowthUnit });
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
      await deleteRuleset(deleteTarget);
      if (selectedId === deleteTarget) setSelectedId(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>Ruleset一覧</div>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        >
          + 新規Ruleset
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {rulesets.map((r) => (
          <Card
            key={r.id}
            onClick={() => {
              setCreating(false);
              setSelectedId(r.id);
            }}
            style={{ cursor: 'pointer', borderColor: selectedId === r.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{r.label}</div>
            <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>{r.desc}</div>
          </Card>
        ))}
        {rulesets.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ登録が無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(id)" hint="内部で使う一意なキー(英数字推奨)。">
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="例: homebrew" style={inputStyle} />
          </Field>
          <Field label="ラベル">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="ラベル" style={inputStyle} />
          </Field>
          <Field label="説明(desc)">
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="説明" style={inputStyle} />
          </Field>
          <Field label="演出ヒント(hint)" hint="任意。GMの演出指示に使われる。">
            <textarea
              value={newHint}
              onChange={(e) => setNewHint(e.target.value)}
              rows={4}
              placeholder="演出ヒント(任意)"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="成長の呼び名(growthUnit)" hint="任意。未入力なら「経験値」として扱われる。例: 経験値・CP・SP等。">
            <input
              value={newGrowthUnit}
              onChange={(e) => setNewGrowthUnit(e.target.value)}
              placeholder="例: 経験値"
              style={inputStyle}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newId || !newLabel}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && selectedId && (
        <Card>
          <Field label="ラベル">
            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="説明(desc)">
            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="演出ヒント(hint)">
            <textarea
              value={editHint}
              onChange={(e) => setEditHint(e.target.value)}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="成長の呼び名(growthUnit)" hint="任意。未入力なら「経験値」として扱われる。">
            <input value={editGrowthUnit} onChange={(e) => setEditGrowthUnit(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="brass" onClick={handleSave} disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(selectedId)} disabled={busy}>
              削除
            </Button>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`Ruleset「${deleteTarget}」を削除する。よいか?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
