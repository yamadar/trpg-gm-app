import { apiFetch } from './apiFetch.js';

export async function callTextOperation(operation, input) {
  return apiFetch(`/api/text-operations/${encodeURIComponent(operation)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
}

// 既存モジュールのモック境界を保つ互換名。任意リクエスト本文は受けず、固定操作名と入力だけを送る。
export async function callTextModel(operation, input) {
  return callTextOperation(operation, input);
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
