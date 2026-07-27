// Responses produced through structured model output occasionally contain a
// second layer of escaped line breaks ("\\n"). Markdown parsers need real line
// breaks, so normalize that transport artifact at the boundary.
export function normalizeMarkdown(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\n/g, '\n');
}

