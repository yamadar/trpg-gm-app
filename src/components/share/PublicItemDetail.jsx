import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import ConfirmModal from '../library/ConfirmModal.jsx';
import { importWorld, importCharacter, importScenario, publicNovelImageUrl } from '../../api/shareClient.js';
import { listWorlds } from '../../api/worldLibraryClient.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { KIND_LABELS } from '../../constants/publicContent.js';
import MarkdownEditor from '../ui/MarkdownEditor.jsx';

// 「もう一度別の◯◯として取り込むか」の確認文で使う。UIの他の場所(既存Worldを選ぶ・
// 追加先のWorldを選択)と同じ呼び方に揃える。
const TYPE_NOUN = { worlds: 'World', characters: 'Character', scenarios: 'Scenario' };

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

const IMAGE_MARKER_RE = /〈挿絵(\d+)〉/g;

// 本文マーカーと公開時に複製された画像の対応を保つ。生成AIがマーカーを
// 本文へ置かなかった画像も末尾へ回し、公開時に挿絵が欠落しないようにする。
export function publicNovelBlocks(raw, imageIds = []) {
  const source = String(raw ?? '');
  const blocks = [];
  const used = new Set();
  let cursor = 0;

  for (const match of source.matchAll(IMAGE_MARKER_RE)) {
    const text = source.slice(cursor, match.index);
    if (text.trim()) blocks.push({ type: 'text', value: text });
    const n = Number(match[1]);
    const imageId = imageIds[n - 1];
    if (imageId && !used.has(n)) {
      blocks.push({ type: 'image', n, imageId });
      used.add(n);
    }
    cursor = match.index + match[0].length;
  }
  const tail = source.slice(cursor);
  if (tail.trim()) blocks.push({ type: 'text', value: tail });

  imageIds.forEach((imageId, index) => {
    const n = index + 1;
    if (imageId && !used.has(n)) blocks.push({ type: 'image', n, imageId });
  });
  return blocks;
}

function PublicNovelBody({ item }) {
  return publicNovelBlocks(item.raw, item.imageIds).map((block, index) =>
    block.type === 'text' ? (
      <MarkdownEditor
        key={`text-${index}`}
        value={block.value}
        label={`${item.title}の本文 ${index + 1}`}
        readOnly
        minHeight={0}
      />
    ) : (
      <figure key={`image-${block.n}`} style={{ margin: '24px 0', textAlign: 'center' }}>
        <img
          src={publicNovelImageUrl(item.publicId, block.imageId)}
          alt={`場面の挿絵 ${block.n}`}
          loading="lazy"
          style={{ display: 'block', width: 'auto', maxWidth: '100%', height: 'auto', margin: '0 auto' }}
        />
      </figure>
    )
  );
}

// 戻る導線は持たない。詳細は URL(#/browse/:tab/:id・#/u/:userId/:tab/:id)で表せる
// ようになったため、シェルのパンくずの1つ手前の段が一覧への行き先そのものになる。
export default function PublicItemDetail({ type, item, onAuthorClick }) {
  const { user } = useAuth();

  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState('');
  const [addError, setAddError] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWorlds, setPickerWorlds] = useState([]);
  const [pickerError, setPickerError] = useState('');
  // 取り込み済みだったときの確認。null は閉じている状態。
  // worldId は Character / Scenario の取り込み先(Worldの取り込みでは null)で、
  // 「複製する」を選んだときに同じ宛先で叩き直すために覚えておく。
  const [duplicateConfirm, setDuplicateConfirm] = useState(null); // { worldId } | null

  async function runImport(worldId, duplicate) {
    setAdding(true);
    setAddError('');
    setAddMessage('');
    try {
      if (type === 'worlds') {
        await importWorld(item.publicId, { duplicate });
      } else if (type === 'characters') {
        await importCharacter(item.publicId, worldId, { duplicate });
      } else {
        await importScenario(item.publicId, worldId, { duplicate });
      }
      setAddMessage('ライブラリに追加しました');
      setDuplicateConfirm(null);
      setPickerOpen(false);
    } catch (e) {
      // 既に取り込んである。黙って複製するとユーザーの知らないうちに素材が増えるので、
      // 別のものとして取り込むかどうかを本人に決めてもらう。
      if (e.body?.error === 'already_imported') {
        setDuplicateConfirm({ worldId });
      } else {
        setAddError(e.message);
        setDuplicateConfirm(null);
      }
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

  return (
    <div>
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

        <div style={{ marginBottom: 16 }}>
          {type === 'novels' ? (
            <PublicNovelBody item={item} />
          ) : (
            <MarkdownEditor value={item.raw} label={`${item.title}の本文`} readOnly minHeight={0} />
          )}
        </div>

        {type === 'worlds' && (
          <>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 8 }}>
              地域(region)
            </div>
            {(item.regions || []).map((r) => (
              <div key={r.name} style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 4 }}>
                  {r.title || '名称未設定の地域'}
                </div>
                <MarkdownEditor value={r.raw} label={`${r.title || '名称未設定の地域'}の本文`} readOnly minHeight={0} />
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
                  {c.title || '名称未設定のカテゴリ'}
                </div>
                <MarkdownEditor value={c.raw} label={`${c.title || '名称未設定のカテゴリ'}の本文`} readOnly minHeight={0} />
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
              <Button
                variant="brass"
                onClick={type === 'worlds' ? () => runImport(null, false) : openPicker}
                disabled={adding}
              >
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
                  <Card key={w.id} onClick={() => runImport(w.id, false)} style={{ cursor: 'pointer' }}>
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

      {/* 取り込み先ピッカーより後ろに置く。どちらも z-index は同じなので、
          後から描かれたこちらが手前に来る(ピッカーは背後に残り、キャンセルすれば
          別のWorldを選び直せる)。 */}
      <ConfirmModal
        open={duplicateConfirm !== null}
        message={`「${item.title}」は取り込み済みですが、もう一度別の${TYPE_NOUN[type] ?? '素材'}として取り込みますか?`}
        confirmLabel="取り込む"
        confirmDisabled={adding}
        onConfirm={() => runImport(duplicateConfirm?.worldId ?? null, true)}
        onCancel={() => setDuplicateConfirm(null)}
      />
    </div>
  );
}
