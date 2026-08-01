import { callTextModel, extractText, parseJsonLoose } from './client.js';

// 抽出スキーマを変えたらこの値を上げる。characterSheetCache がハッシュに混ぜており、
// 既存の parsed キャッシュが無効化されて次回使用時に一度だけ解析し直される。
// v2: name(キャラクター名)を追加。
export const SHEET_PARSE_VERSION = 2;

export async function parseCharacterSheet(raw) {
  const data = await callTextModel('parse-character-sheet', { raw });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    name: parsed.name || '',
    goal: parsed.goal || '',
    bonds: parsed.bonds || '',
  };
}
