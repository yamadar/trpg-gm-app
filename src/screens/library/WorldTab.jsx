import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import {
  getWorld,
  deleteWorld,
  putRegion,
  putCategory,
  putWorldSource,
  listRegions,
  getRegion,
  listCategories,
  getCategory,
} from '../../api/worldLibraryClient.js';
import { importWorld, reimportWorld } from '../../api/worldImport.js';
import { publishWorld, unpublishWorld, publishedWorlds as fetchPublishedWorlds } from '../../api/shareClient.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MoodChips from '../../components/ui/MoodChips.jsx';

export default function WorldTab({ worlds, selectedWorldId, onSelectWorld, onWorldsChanged }) {
  const { user } = useAuth();
  const [publishedWorldIds, setPublishedWorldIds] = useState({});
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newRaw, setNewRaw] = useState('');

  const [detail, setDetail] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRaw, setEditRaw] = useState('');
  const [editMoods, setEditMoods] = useState([]);
  const [adjustmentRequest, setAdjustmentRequest] = useState('');
  const [regions, setRegions] = useState([]); // [{id, title, content}] content may be null until fetched
  const [categories, setCategories] = useState([]);
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [regionDraft, setRegionDraft] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const worldEpochRef = useRef(0);

  useEffect(() => {
    if (!selectedWorldId) {
      setDetail(null);
      return;
    }
    worldEpochRef.current += 1;
    setEditingRegionId(null);
    setRegionDraft('');
    setEditingCategoryId(null);
    setCategoryDraft('');
    setRegions([]);
    setCategories([]);
    setError('');
    let cancelled = false;
    (async () => {
      try {
        const world = await getWorld(selectedWorldId);
        if (cancelled) return;
        setDetail(world);
        setEditTitle(world.title);
        setEditRaw(world.raw);
        setEditMoods(world.moods ?? []);
        const [regionIds, categoryIds] = await Promise.all([
          listRegions(selectedWorldId),
          listCategories(selectedWorldId),
        ]);
        if (cancelled) return;
        setRegions(regionIds.map((id) => ({ id, title: id, content: null })));
        setCategories(categoryIds.map((id) => ({ id, title: id, content: null })));
      } catch (e) {
        if (!cancelled) setError('World取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorldId]);

  useEffect(() => {
    if (!user) {
      setPublishedWorldIds({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const map = await fetchPublishedWorlds();
        if (!cancelled) setPublishedWorldIds(map);
      } catch (e) {
        if (!cancelled) setError('公開状態の取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handlePublishWorld(worldId) {
    setBusy(true);
    setError('');
    try {
      const { publicId } = await publishWorld(worldId);
      setPublishedWorldIds((prev) => ({ ...prev, [worldId]: publicId }));
    } catch (e) {
      setError('公開に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublishWorld(worldId) {
    setBusy(true);
    setError('');
    try {
      await unpublishWorld(worldId);
      setPublishedWorldIds((prev) => {
        const next = { ...prev };
        delete next[worldId];
        return next;
      });
    } catch (e) {
      setError('公開解除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      const split = await importWorld(newId, newTitle, newRaw);
      setRegions(split.regions.map((r) => ({ id: r.id, title: r.title, content: r.content })));
      setCategories(split.categories.map((c) => ({ id: c.id, title: c.title, content: c.content })));
      setCreating(false);
      const createdId = newId;
      setNewId('');
      setNewTitle('');
      setNewRaw('');
      await onWorldsChanged();
      onSelectWorld(createdId);
    } catch (e) {
      setError('World作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReimport() {
    setBusy(true);
    setError('');
    try {
      if (editRaw !== detail.raw) {
        await putWorldSource(selectedWorldId, editRaw);
      }
      const split = await reimportWorld(selectedWorldId, editTitle, adjustmentRequest || undefined, editMoods);
      setRegions(split.regions.map((r) => ({ id: r.id, title: r.title, content: r.content })));
      setCategories(split.categories.map((c) => ({ id: c.id, title: c.title, content: c.content })));
      setAdjustmentRequest('');
      await onWorldsChanged();
      const world = await getWorld(selectedWorldId);
      setDetail(world);
      setEditTitle(world.title);
      setEditRaw(world.raw);
      setEditMoods(world.moods ?? []);
    } catch (e) {
      setError('World更新に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleEditMood(mood) {
    setEditMoods((prev) => (prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood]));
  }

  async function startEditingRegion(region) {
    setEditingRegionId(region.id);
    if (region.content !== null) {
      setRegionDraft(region.content);
      return;
    }
    const epoch = worldEpochRef.current;
    try {
      const full = await getRegion(selectedWorldId, region.id);
      if (worldEpochRef.current !== epoch) return;
      setRegionDraft(full.raw);
    } catch (e) {
      if (worldEpochRef.current === epoch) setError('地域の取得に失敗した: ' + e.message);
    }
  }

  async function startEditingCategory(category) {
    setEditingCategoryId(category.id);
    if (category.content !== null) {
      setCategoryDraft(category.content);
      return;
    }
    const epoch = worldEpochRef.current;
    try {
      const full = await getCategory(selectedWorldId, category.id);
      if (worldEpochRef.current !== epoch) return;
      setCategoryDraft(full.raw);
    } catch (e) {
      if (worldEpochRef.current === epoch) setError('カテゴリの取得に失敗した: ' + e.message);
    }
  }

  async function handleSaveRegion(regionId) {
    setBusy(true);
    setError('');
    try {
      await putRegion(selectedWorldId, regionId, regionDraft);
      setRegions((prev) => prev.map((r) => (r.id === regionId ? { ...r, content: regionDraft } : r)));
      setEditingRegionId(null);
    } catch (e) {
      setError('地域の保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCategory(categoryId) {
    setBusy(true);
    setError('');
    try {
      await putCategory(selectedWorldId, categoryId, categoryDraft);
      setCategories((prev) => prev.map((c) => (c.id === categoryId ? { ...c, content: categoryDraft } : c)));
      setEditingCategoryId(null);
    } catch (e) {
      setError('カテゴリの保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await deleteWorld(deleteTarget);
      const deletedId = deleteTarget;
      setDeleteTarget(null);
      if (selectedWorldId === deletedId) {
        onSelectWorld(null);
        setDetail(null);
      }
      await onWorldsChanged();
    } catch (e) {
      setError('World削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>World一覧</div>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            onSelectWorld(null);
          }}
        >
          + 新規World
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {worlds.map((w) => (
          <Card
            key={w.id}
            onClick={() => {
              setCreating(false);
              onSelectWorld(w.id);
            }}
            style={{ cursor: 'pointer', borderColor: selectedWorldId === w.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{w.title}</div>
                {w.moods && w.moods.length > 0 && (
                  <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
                    {w.moods.join(' / ')}
                  </div>
                )}
              </div>
              {user && (
                <div
                  style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {publishedWorldIds[w.id] ? (
                    <>
                      <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark }}>公開中</span>
                      <Button variant="ghost" onClick={() => handlePublishWorld(w.id)} disabled={busy}>
                        再公開
                      </Button>
                      <Button variant="ghost" onClick={() => handleUnpublishWorld(w.id)} disabled={busy}>
                        公開解除
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => handlePublishWorld(w.id)} disabled={busy}>
                      公開
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
        {worlds.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>Worldがまだ無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(id)" hint="内部で使う一意なキー(英数字推奨)。本文中の名称とは別。">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="例: waterdeep-campaign"
              style={inputStyle}
            />
          </Field>
          <Field label="タイトル">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="World名"
              style={inputStyle}
            />
          </Field>
          <Field label="本文" hint="長文なら自動でregion/categoryに分割される。">
            <textarea
              value={newRaw}
              onChange={(e) => setNewRaw(e.target.value)}
              rows={10}
              placeholder="世界観の資料を貼る"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newId || !newTitle}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && detail && (
        <Card>
          <Field label="タイトル">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="本文">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={10}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="雰囲気" hint="複数選択可。">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <MoodChips selected={editMoods} onToggle={toggleEditMood} />
            </div>
          </Field>
          <Field label="再分割の修正依頼" hint="任意。空欄でも再分割できる。">
            <input value={adjustmentRequest} onChange={(e) => setAdjustmentRequest(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button variant="brass" onClick={handleReimport} disabled={busy}>
              {busy ? '更新中…' : '保存して再分割'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(detail.id)} disabled={busy}>
              削除
            </Button>
          </div>

          <div>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 8 }}>
              地域(region)
            </div>
            {regions.map((r) => (
              <Card key={r.id} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>
                  {r.title}
                </div>
                {editingRegionId === r.id ? (
                  <>
                    <textarea
                      value={regionDraft}
                      onChange={(e) => setRegionDraft(e.target.value)}
                      rows={6}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY, marginBottom: 8 }}
                    />
                    <Button variant="brass" onClick={() => handleSaveRegion(r.id)} disabled={busy}>
                      保存
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => startEditingRegion(r)}>
                    編集
                  </Button>
                )}
              </Card>
            ))}
            {regions.length === 0 && (
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
            {categories.map((c) => (
              <Card key={c.id} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>
                  {c.title}
                </div>
                {editingCategoryId === c.id ? (
                  <>
                    <textarea
                      value={categoryDraft}
                      onChange={(e) => setCategoryDraft(e.target.value)}
                      rows={6}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY, marginBottom: 8 }}
                    />
                    <Button variant="brass" onClick={() => handleSaveCategory(c.id)} disabled={busy}>
                      保存
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => startEditingCategory(c)}>
                    編集
                  </Button>
                )}
              </Card>
            ))}
            {categories.length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint }}>
                カテゴリは無い。
              </div>
            )}
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`World「${deleteTarget}」を削除する。よいか?`}
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
