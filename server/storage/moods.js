// 語彙は src/constants/moods.js と同内容の二重定義(サーバーはクライアントのソースを import しない方針のため複製。server/storage/slugify.js ↔ src/utils/slugify.js と同じ前例)
export const MOODS = ['ホラー', '冒険', 'ミステリー', '日常', 'SF', 'ファンタジー', 'コメディ', 'シリアス'];

export function isValidMoods(value) {
  return Array.isArray(value) && value.every((m) => MOODS.includes(m));
}
