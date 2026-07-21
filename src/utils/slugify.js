export function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'untitled';
}
