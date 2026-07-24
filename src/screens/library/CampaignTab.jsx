import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { listCampaigns, getCampaign, putCampaign, deleteCampaign } from '../../api/campaignClient.js';

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ja-JP');
  } catch {
    return '';
  }
}

export default function CampaignTab({ worldId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loaded, setLoaded] = useState(null); // 選択中campaignの全メタ
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    if (!worldId) return;
    try {
      setError('');
      setCampaigns(await listCampaigns(worldId));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    setLoaded(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getCampaign(worldId, selectedId);
        if (cancelled) return;
        setLoaded(c);
        setEditTitle(c.title);
      } catch (e) {
        if (!cancelled) setError('取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await putCampaign(worldId, selectedId, {
        title: editTitle,
        carriedPc: loaded.carriedPc,
        chapters: loaded.chapters,
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
      await deleteCampaign(worldId, deleteTarget);
      if (selectedId === deleteTarget) {
        setSelectedId(null);
        setLoaded(null);
      }
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
      <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink, marginBottom: 16 }}>
        Campaign一覧
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {campaigns.map((c) => (
          <Card
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{ cursor: 'pointer', borderColor: selectedId === c.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{c.title}</div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
              全{(c.chapters || []).length}章 / 更新 {fmtDate(c.updatedAt)}
            </div>
          </Card>
        ))}
        {campaigns.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
            まだキャンペーンが無い。セッションを終えて「次の章へ」から作成される。
          </div>
        )}
      </div>

      {selectedId && loaded && (
        <Card>
          <Field label="タイトル">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
          </Field>

          <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, margin: '12px 0 6px' }}>章</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {(loaded.chapters || []).map((ch, i) => (
              <div key={ch.sessionId || i} style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                第{i + 1}章: {ch.title}
                <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}> {fmtDate(ch.endedAt)}</span>
              </div>
            ))}
            {(loaded.chapters || []).length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>章がまだない。</div>
            )}
          </div>

          <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>
            引き継ぎPC
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 6 }}>
            CP: {loaded.carriedPc?.xp ?? 0}
          </div>
          <pre
            style={{
              fontFamily: F_BODY,
              fontSize: 13,
              color: COLORS.inkSoft,
              whiteSpace: 'pre-wrap',
              background: COLORS.card,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 4,
              padding: '8px 10px',
              margin: '0 0 12px',
            }}
          >
            {loaded.carriedPc?.raw || '(PC情報なし)'}
          </pre>

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
        message={`キャンペーン「${loaded?.title ?? deleteTarget}」を削除する。よいか?`}
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
