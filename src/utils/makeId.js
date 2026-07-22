import { slugify } from './slugify.js';

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export function makeId(base) {
  return `${slugify(base || 'untitled')}-${Date.now()}-${randomSuffix()}`;
}
