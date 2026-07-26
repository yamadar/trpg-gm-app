// 素材ライブラリのタブ定義。URL の :tab セグメント(src/navigation/routes.js)と
// 画面のタブ列(src/screens/Library.jsx)が同じ定義を共有するためにここへ置く。
export const LIBRARY_TABS = [
  { key: 'world', label: 'World' },
  { key: 'character', label: 'Character' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'ruleset', label: 'Ruleset' },
];

// World に紐づくタブ。URL の3セグメント目に worldId を取る。
// world タブ自身も選択中の World を詳細/編集表示するため(src/screens/library/WorldTab.jsx)含める。
// ruleset だけが World に依存しない。
export const WORLD_SCOPED_LIBRARY_TABS = ['world', 'character', 'scenario', 'campaign'];
