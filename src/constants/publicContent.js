// UserPage.jsx はこの配列をそのまま PublicItemList type= に渡す(GET /api/public/:type)。
// starters は /api/public/:type の TYPES に含まれない別概念(パック一括インポート)のため、
// ここには加えない(加えるとユーザーページの「おすすめ」タブが常に404になる)。
export const PUBLIC_TABS = [
  { key: 'novels', label: '小説' },
  { key: 'worlds', label: '世界観' },
  { key: 'characters', label: 'キャラクター' },
  { key: 'scenarios', label: 'シナリオ' },
];

// 公開ギャラリー(Gallery.jsx)専用のタブ列。starters は PublicItemList を経由せず
// StarterPackList を直接描画するため、Gallery側だけがこの並びを使う。
export const GALLERY_TABS = [{ key: 'starters', label: 'おすすめ' }, ...PUBLIC_TABS];

export const KIND_LABELS = { pc: 'PC', npc: 'NPC' };
