import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getScenario, putScenario, listScenarios, deleteScenario } from '../../api/scenarioLibraryClient.js';

export default function ScenarioTab({ worldId }) {
  const [scenarios, setScenarios] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newRaw, setNewRaw] = useState('');
  const [newRecommendedRuleset, setNewRecommendedRuleset] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRaw, setEditRaw] = useState('');
  const [editRecommendedRuleset, setEditRecommendedRuleset] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    if (!worldId) return;
    try {
      setError('');
      setScenarios(await listScenarios(worldId));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    setCreating(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getScenario(worldId, selectedId);
        if (cancelled) return;
        setEditTitle(s.title);
        setEditRaw(s.raw);
        setEditRecommendedRuleset(s.recommendedRuleset || '');
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
      await putScenario(worldId, newId, {
        title: newTitle,
        raw: newRaw,
        recommendedRuleset: newRecommendedRuleset || null,
      });
      setNewId('');
      setNewTitle('');
      setNewRaw('');
      setNewRecommendedRuleset('');
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
      await putScenario(worldId, selectedId, {
        title: editTitle,
        raw: editRaw,
        recommendedRuleset: editRecommendedRuleset || null,
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
      await deleteScenario(worldId, deleteTarget);
      if (selectedId === deleteTarget) setSelectedId(null);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>Scenario一覧</div>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        >
          + 新規Scenario
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {scenarios.map((s) => (
          <Card
            key={s.id}
            onClick={() => {
              setCreating(false);
              setSelectedId(s.id);
            }}
            style={{ cursor: 'pointer', borderColor: selectedId === s.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{s.title}</div>
            <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>
              推奨ルール: {s.recommendedRuleset || '未設定'}
            </div>
          </Card>
        ))}
        {scenarios.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ登録が無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(id)" hint="内部で使う一意なキー(英数字推奨)。">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="例: missing-heir"
              style={inputStyle}
            />
          </Field>
          <Field label="タイトル">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="シナリオタイトル"
              style={inputStyle}
            />
          </Field>
          <Field label="本文">
            <textarea
              value={newRaw}
              onChange={(e) => setNewRaw(e.target.value)}
              rows={8}
              placeholder="シナリオ本文"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="推奨ルール(recommendedRuleset)" hint="任意。自由テキスト。">
            <input
              value={newRecommendedRuleset}
              onChange={(e) => setNewRecommendedRuleset(e.target.value)}
              placeholder="例: coc7e"
              style={inputStyle}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newId || !newTitle}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && selectedId && (
        <Card>
          <Field label="タイトル">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="本文">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="推奨ルール(recommendedRuleset)" hint="任意。自由テキスト。">
            <input
              value={editRecommendedRuleset}
              onChange={(e) => setEditRecommendedRuleset(e.target.value)}
              style={inputStyle}
            />
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
        message={`Scenario「${deleteTarget}」を削除する。よいか?`}
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
