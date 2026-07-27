// キャラクターシート本文から、一覧に出すための「見出し」と「抜粋」を作る。
// 一覧はメタデータしか返さないため、これが無いと選ぶ側にはストレージ上の名前(id)しか
// 見えない。PC選択のように「どんなキャラクターか」で選ぶ画面のために付ける。

// 「PC名: ○○」「NPC名: ○○」の書式を表示名として扱う。
// 全角コロンも許すのは、日本語入力のまま書いた本文を弾かないため。
const CHARACTER_NAME_LINE = /^[ \t]*(?:PC|NPC)名[ \t]*[:：][ \t]*(.+?)[ \t\r]*$/m;

// カードに1〜2行で収まる長さ。これより長い本文は末尾を省略する。
const EXCERPT_LIMIT = 120;

export function summarizeSheet(raw) {
  const text = String(raw ?? '');
  const nameMatch = text.match(CHARACTER_NAME_LINE);
  // 見出し記号や箇条書きの印は、1行に潰すと意味を持たないので落とす。
  // 行の区切りは ' / ' にして、能力値・goal・bonds が地続きに見えないようにする。
  const body = text
    .replace(CHARACTER_NAME_LINE, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#+|>+|[-*+])\s*/, '').trim())
    .filter(Boolean)
    .join(' / ');
  return {
    displayName: nameMatch ? nameMatch[1].trim() : '',
    excerpt: body.length > EXCERPT_LIMIT ? `${body.slice(0, EXCERPT_LIMIT)}…` : body,
  };
}
