import { apiFetch } from './apiFetch.js';

export async function callClaude(body) {
  return apiFetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export function extractToolUse(content) {
  return (content || []).find((b) => b.type === 'tool_use');
}

export function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON not found in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}
