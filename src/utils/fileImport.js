const PLAIN_TEXT_RE = /\.(md|markdown|txt)$/i;
const HTML_RE = /\.html?$/i;

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc
    .querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, blockquote')
    .forEach((el) => el.insertAdjacentText('afterend', '\n'));
  const text = (doc.body ? doc.body.textContent : doc.textContent) || '';
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function readFilesAsEntries(fileList) {
  const files = Array.from(fileList).filter(
    (f) => PLAIN_TEXT_RE.test(f.name) || HTML_RE.test(f.name)
  );
  files.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)
  );
  const entries = await Promise.all(
    files.map(async (f) => {
      const raw = await f.text();
      const content = HTML_RE.test(f.name) ? htmlToText(raw) : raw;
      return { name: f.webkitRelativePath || f.name, content };
    })
  );
  return entries;
}

export function combineEntries(entries) {
  return entries.map((e) => `===== ${e.name} =====\n${e.content}`).join('\n\n');
}
