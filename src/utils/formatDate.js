// 図鑑と実績で同じ整形を使うための共有ユーティリティ。ローカルタイムゾーンで日付にする。
export function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
