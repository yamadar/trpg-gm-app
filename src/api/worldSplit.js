import { callTextModel, extractText, parseJsonLoose } from './client.js';
import { slugify } from '../utils/slugify.js';
import { normalizeMarkdown } from '../utils/markdown.js';

function dedupeIds(items) {
  const used = new Set();
  return items.map((item) => {
    let candidate = item.id;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${item.id}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate === item.id ? item : { ...item, id: candidate };
  });
}

function normalizeItems(items) {
  return dedupeIds(
    items.map((item) => {
      const id = slugify(item.id);
      return {
        ...item,
        id,
        title: String(item.title || id).trim(),
        content: normalizeMarkdown(item.content),
      };
    })
  );
}

export async function splitWorld(rawText, adjustmentRequest) {
  const data = await callTextModel('split-world', { rawText, adjustmentRequest });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    world: normalizeMarkdown(parsed.world),
    regions: normalizeItems(parsed.regions || []),
    categories: normalizeItems(parsed.categories || []),
  };
}
