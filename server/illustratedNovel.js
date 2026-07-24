import { IMAGE_MARKER_RE } from './novelMarkers.js';

function toDataUri(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// novelText中の〈挿絵N〉を data URI 画像に置換する。
// - 範囲外番号・画像なし(null)は除去
// - 同じ番号の2回目以降は除去
// - 本文に現れなかった番号で画像があるものは末尾「## 挿絵」節に救済(取りこぼしゼロ)
export function buildIllustratedMarkdown({ novelText, imageIds = [], images = new Map() }) {
  const used = new Set();
  const body = String(novelText ?? '').replace(IMAGE_MARKER_RE, (match, numStr) => {
    const n = Number(numStr);
    const imageId = imageIds[n - 1];
    if (!imageId || used.has(n)) return '';
    const buf = images.get(imageId);
    if (!buf) return '';
    used.add(n);
    return `![挿絵${n}](${toDataUri(buf)})`;
  });
  const leftovers = imageIds
    .map((imageId, idx) => ({ n: idx + 1, buf: images.get(imageId) }))
    .filter(({ n, buf }) => !used.has(n) && buf);
  if (leftovers.length === 0) return body;
  const tail = leftovers.map(({ n, buf }) => `![挿絵${n}](${toDataUri(buf)})`).join('\n\n');
  return `${body}\n\n## 挿絵\n\n${tail}\n`;
}
