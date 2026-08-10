import MarkdownEditor from '../ui/MarkdownEditor.jsx';

const IMAGE_MARKER_RE = /〈挿絵(\d+)〉/g;

// 本文マーカーと画像の対応を保つ。マーカーの無い画像を末尾へ並べると本文と無関係な
// 場所へ挿絵が移動するため、明示された位置に対応する画像だけを表示する。
export function novelBlocks(raw, imageIds = []) {
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

  return blocks;
}

// 公開ギャラリーと本人専用の読書画面で同じ本文・挿絵表示を使う。
export default function NovelBody({ raw, imageIds = [], imageUrl, title = '小説' }) {
  return novelBlocks(raw, imageIds).map((block, index) =>
    block.type === 'text' ? (
      <MarkdownEditor
        key={`text-${index}`}
        value={block.value}
        label={`${title}の本文 ${index + 1}`}
        readOnly
        minHeight={0}
      />
    ) : (
      <figure key={`image-${block.n}`} style={{ margin: '24px 0', textAlign: 'center' }}>
        <img
          src={imageUrl(block.imageId)}
          alt={`場面の挿絵 ${block.n}`}
          loading="lazy"
          style={{ display: 'block', width: 'auto', maxWidth: '100%', height: 'auto', margin: '0 auto' }}
        />
      </figure>
    )
  );
}
