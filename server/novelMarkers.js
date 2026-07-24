// 小説化トランスクリプトへの挿絵マーカーの埋め込みと除去。
// マーカーは「〈挿絵N〉」(N=1始まり)で、imageIds[N-1] が対応する imageId。
export const IMAGE_MARKER_RE = /〈挿絵(\d+)〉/g;

export function buildTranscriptWithMarkers(log) {
  const lines = [];
  const imageIds = [];
  for (const entry of log || []) {
    if (entry.role === 'gm' && entry.image?.imageId) {
      imageIds.push(entry.image.imageId);
      lines.push(`〈挿絵${imageIds.length}〉`);
    }
    lines.push(`${entry.role === 'player' ? 'PL' : 'GM'}: ${entry.text}`);
  }
  return { transcript: lines.join('\n'), imageIds };
}

export function stripImageMarkers(text) {
  // マーカーだけの行は行ごと除去し、本文中に紛れたマーカーは文字列としてのみ除去する。
  return String(text ?? '')
    .replace(/^〈挿絵\d+〉$\n?/gm, '')
    .replace(IMAGE_MARKER_RE, '');
}
