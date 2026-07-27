const BASE_STYLE = 'atmospheric digital illustration, detailed, cinematic lighting, no text, no speech bubbles';

// キーは src/constants/moods.js / server/storage/moods.js の MOODS(固定8種)と対応。
const MOOD_STYLE = {
  ホラー: 'dark, ominous, unsettling horror mood',
  冒険: 'epic adventurous fantasy',
  ミステリー: 'moody noir, muted tones',
  日常: 'warm slice-of-life',
  SF: 'sci-fi, cool tones, futuristic',
  ファンタジー: 'high fantasy, painterly',
  コメディ: 'bright cheerful',
  シリアス: 'somber, desaturated',
};

const NARRATIVE_MAX = 400;

export function buildImagePrompt({ narrative = '', moods = [], appearances = [], hasReferences = false }) {
  const moodKey = Array.isArray(moods) ? moods.find((m) => MOOD_STYLE[m]) : undefined;
  const style = moodKey ? MOOD_STYLE[moodKey] : 'neutral tone';
  const scene = String(narrative || '').slice(0, NARRATIVE_MAX).trim();
  const cast = (appearances || [])
    .filter((a) => a && a.name && a.description)
    .map((a) => `${a.name}=${a.description}`)
    .join(', ');
  const lines = [`${BASE_STYLE}, ${style}.`];
  if (cast) lines.push(`登場人物: ${cast}`);
  lines.push('人物を描く場合、各人物を場面の出来事に反応した自然な動作中の姿で描く。重心・手足・視線を状況に合わせ、互いと環境との関係が分かるポーズにする。');
  lines.push('人物を描く場合、各人物の表情を場面の感情と緊張度に合わせる。場面が明示的に静止・無感情を求めない限り、棒立ち、正面向きの記念写真風ポーズ、無表情を避ける。風景・物だけの場面へ人物を追加しない。');
  if (scene) lines.push(`場面: ${scene}`);
  if (hasReferences) lines.push('参照画像の人物の外見(顔・髪・服装)を厳密に維持すること。');
  return lines.join('\n');
}

// キャラポートレート用プロンプト。シーン挿絵の参照画像として使うため
// バストアップ・無地背景に固定し、画風はシーンと同じmoodマッピングを共用する。
export function buildPortraitPrompt({ name = '', description = '', moods = [] }) {
  const moodKey = Array.isArray(moods) ? moods.find((m) => MOOD_STYLE[m]) : undefined;
  const style = moodKey ? MOOD_STYLE[moodKey] : 'neutral tone';
  const lines = [`character portrait, bust shot, plain background, ${BASE_STYLE}, ${style}.`];
  if (name || description) lines.push(`人物: ${name}=${description}`);
  return lines.join('\n');
}
