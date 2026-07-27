import { IMAGE_MARKER_RE } from './novelMarkers.js';

function toDataUri(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInlineMarkdown(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// 小説化プロンプトが生成する限定的なMarkdown(小見出し・太字・段落)だけを
// HTMLへ変換する。先にエスケープし、AI出力をHTMLとして実行させない。
function renderMarkdownFragment(value) {
  const blocks = [];
  let paragraph = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  }

  for (const line of String(value ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    const heading = /^(#{2,3})[ \t]+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    paragraph.push(renderInlineMarkdown(trimmed));
  }
  flushParagraph();
  return blocks.join('\n');
}

// 連番以外の意味を持たない「挿絵12」などの説明は表示しない。
// 本文が画像の文脈を担うため、装飾画像として空の代替テキストにする。
function imageFigure(buf) {
  return `<figure><img src="${toDataUri(buf)}" alt=""></figure>`;
}

// novelText中の〈挿絵N〉を data URI 画像へ置換し、単体で閲覧できるHTMLにする。
// - 範囲外番号・画像なし(null)は除去
// - 同じ番号の2回目以降は除去
// - 本文に現れなかった番号で画像があるものは末尾「挿絵」節に救済(取りこぼしゼロ)
// - AI生成本文とタイトルは必ずエスケープし、HTMLとして実行させない
export function buildIllustratedHtml({ title = '小説', novelText, imageIds = [], images = new Map() }) {
  const used = new Set();
  const bodyParts = [];
  let cursor = 0;
  const source = String(novelText ?? '');

  for (const match of source.matchAll(IMAGE_MARKER_RE)) {
    bodyParts.push(renderMarkdownFragment(source.slice(cursor, match.index)));
    const n = Number(match[1]);
    const imageId = imageIds[n - 1];
    if (imageId && !used.has(n)) {
      const buf = images.get(imageId);
      if (buf) {
        used.add(n);
        bodyParts.push(imageFigure(buf));
      }
    }
    cursor = match.index + match[0].length;
  }
  bodyParts.push(renderMarkdownFragment(source.slice(cursor)));

  const leftovers = imageIds
    .map((imageId, idx) => ({ n: idx + 1, buf: images.get(imageId) }))
    .filter(({ n, buf }) => !used.has(n) && buf);
  const tail = leftovers.length
    ? `<section class="illustrations"><h2>挿絵</h2>${leftovers.map(({ buf }) => imageFigure(buf)).join('')}</section>`
    : '';
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      background: #ede6d6;
      color: #2f2b25;
      font-family: "Yu Mincho", "Hiragino Mincho ProN", Georgia, serif;
      line-height: 1.9;
    }
    main {
      box-sizing: border-box;
      max-width: 52rem;
      min-height: 100vh;
      margin: 0 auto;
      padding: 3rem clamp(1.25rem, 5vw, 4rem);
      background: #f6f1e6;
      box-shadow: 0 0 2rem rgb(31 42 56 / 12%);
    }
    h1, h2, h3 { line-height: 1.35; }
    h1 { margin: 0 0 2.5rem; text-align: center; }
    h2 { margin-top: 3rem; border-bottom: 1px solid #c9bfa3; }
    h3 { margin-top: 2rem; }
    p { margin: 1.25rem 0; }
    strong { color: #211d18; font-weight: 700; }
    figure { margin: 2.5rem 0; text-align: center; break-inside: avoid; }
    img { display: block; width: auto; max-width: 100%; height: auto; margin: 0 auto; }
    @media print {
      body, main { background: white; }
      main { max-width: none; padding: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    ${bodyParts.join('')}
    ${tail}
  </main>
</body>
</html>
`;
}
