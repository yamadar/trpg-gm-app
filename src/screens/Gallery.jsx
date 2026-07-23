import { useState, useEffect, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { listPublic, getPublic, importWorld, importCharacter, importScenario } from '../api/shareClient.js';
import { listWorlds } from '../api/worldLibraryClient.js';
import { useAuth } from '../auth/AuthContext.jsx';

const TABS = [
  { key: 'novels', label: '小説' },
  { key: 'worlds', label: '世界観' },
  { key: 'characters', label: 'キャラクター' },
  { key: 'scenarios', label: 'シナリオ' },
];

const KIND_LABELS = { pc: 'PC', npc: 'NPC' };

function metaLine(item) {
  return `${item.ownerName} ・ ${new Date(item.publishedAt).toLocaleDateString('ja-JP')}`;
}

export default function Gallery({ onClose }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('novels');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState('');
  const [addError, setAddError] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWorlds, setPickerWorlds] = useState([]);
  const [pickerError, setPickerError] = useState('');

  const refresh = useCallback(async (t) => {
    setLoading(true);
    setListError('');
    try {
      setItems(await listPublic(t));
    } catch (e) {
      setListError('一覧の取得に失敗した: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setViewMode('list');
    setDetail(null);
    setDetailError('');
    setAddMessage('');
    setAddError('');
    setPickerOpen(false);
    refresh(tab);
  }, [tab, refresh]);

  function resetAddState() {
    setAddMessage('');
    setAddError('');
    setPickerOpen(false);
    setPickerError('');
  }

  async function openDetail(publicId) {
    setViewMode('detail');
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    resetAddState();
    try {
      setDetail(await getPublic(tab, publicId));
    } catch (e) {
      setDetailError('取得に失敗した: ' + e.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function backToList() {
    setViewMode('list');
    setDetail(null);
    resetAddState();
  }

  async function handleAddWorld() {
    setAdding(true);
    setAddError('');
    setAddMessage('');
    try {
      await importWorld(detail.publicId);
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
      if (tab === 'characters') {
        await importCharacter(detail.publicId, worldId);
      } else {
        await importScenario(detail.publicId, worldId);
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
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink }}>公開ギャラリー</div>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, fontFamily: F_MONO, fontSize: 12 }}>
        {TABS.map((t) => (
          <div
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 3,
              cursor: 'pointer',
              background: tab === t.key ? COLORS.ink : 'transparent',
              color: tab === t.key ? COLORS.paper : COLORS.faint,
              border: `1px solid ${tab === t.key ? COLORS.ink : COLORS.line}`,
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {viewMode === 'list' ? (
        <>
          {listError && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{listError}</div>}
          {loading ? (
            <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it) => (
                <Card key={it.publicId} onClick={() => openDetail(it.publicId)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{it.title}</div>
                    {tab === 'characters' && (
                      <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark }}>
                        {KIND_LABELS[it.kind] || it.kind}
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginTop: 4 }}>
                    {metaLine(it)}
                  </div>
                  {tab === 'scenarios' && it.recommendedRuleset && (
                    <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginTop: 4 }}>
                      推奨ルール: {it.recommendedRuleset}
                    </div>
                  )}
                </Card>
              ))}
              {items.length === 0 && (
                <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
                  まだ公開されたものがありません
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div>
          <Button variant="ghost" onClick={backToList} style={{ marginBottom: 16 }}>
            ← 一覧に戻る
          </Button>

          {detailLoading ? (
            <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
          ) : detailError ? (
            <div style={{ color: COLORS.stamp, fontSize: 13 }}>{detailError}</div>
          ) : (
            detail && (
              <Card>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink, marginBottom: 6 }}>
                  {detail.title}
                </div>
                <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginBottom: 4 }}>
                  {metaLine(detail)}
                </div>
                {tab === 'characters' && (
                  <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
                    {KIND_LABELS[detail.kind] || detail.kind}
                  </div>
                )}
                {tab === 'scenarios' && detail.recommendedRuleset && (
                  <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
                    推奨ルール: {detail.recommendedRuleset}
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
                  {detail.raw}
                </div>

                {tab === 'worlds' && (
                  <>
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 8 }}>
                      地域(region)
                    </div>
                    {(detail.regions || []).map((r) => (
                      <div key={r.name} style={{ marginBottom: 12 }}>
                        <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 4 }}>
                          {r.name}
                        </div>
                        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, whiteSpace: 'pre-wrap' }}>
                          {r.raw}
                        </div>
                      </div>
                    ))}
                    {(detail.regions || []).length === 0 && (
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
                    {(detail.categories || []).map((c) => (
                      <div key={c.name} style={{ marginBottom: 12 }}>
                        <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 4 }}>
                          {c.name}
                        </div>
                        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, whiteSpace: 'pre-wrap' }}>
                          {c.raw}
                        </div>
                      </div>
                    ))}
                    {(detail.categories || []).length === 0 && (
                      <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint }}>カテゴリは無い。</div>
                    )}
                  </>
                )}
              </Card>
            )
          )}

          {tab !== 'novels' && !detailLoading && !detailError && detail && (
            <div style={{ marginTop: 16 }}>
              {!user ? (
                <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
                  追加にはログインが必要です(右上からログイン)
                </div>
              ) : (
                <>
                  <Button variant="brass" onClick={tab === 'worlds' ? handleAddWorld : openPicker} disabled={adding}>
                    {adding ? '追加中…' : 'ライブラリに追加'}
                  </Button>
                  {addMessage && (
                    <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginTop: 8 }}>
                      {addMessage}
                    </div>
                  )}
                  {addError && (
                    <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.stamp, marginTop: 8 }}>
                      {addError}
                    </div>
                  )}
                </>
              )}
            </div>
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
