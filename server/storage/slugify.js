// src/utils/slugify.js と同一実装(サーバーはクライアントのソースを import しない方針のため複製)
export function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'untitled';
}
