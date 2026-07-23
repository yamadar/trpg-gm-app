import { callClaude, extractText, parseJsonLoose } from './client.js';
import { slugify } from '../utils/slugify.js';

const SPLIT_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['world', 'regions', 'categories'],
    properties: {
      world: {
        type: 'string',
        description: '目次+要約のMarkdown本文(600〜900字程度。各regionとcategoryの一行概要を含める)',
      },
      regions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'content'],
          properties: {
            id: { type: 'string', description: '英数字とハイフンのみのスラグ' },
            title: { type: 'string', description: '地域名' },
            content: { type: 'string', description: 'その地域の詳細本文' },
          },
        },
      },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'content'],
          properties: {
            id: { type: 'string', description: '英数字とハイフンのみのスラグ' },
            title: { type: 'string', description: 'カテゴリ名' },
            content: {
              type: 'string',
              description: 'そのカテゴリの詳細本文(魔法体系・宗教・歴史・種族・組織など)',
            },
          },
        },
      },
    },
  },
};

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

export async function splitWorld(rawText, adjustmentRequest) {
  const data = await callClaude({
    model: 'claude-sonnet-5',
    max_tokens: 16000,
    thinking: { type: 'disabled' },
    output_config: { format: SPLIT_OUTPUT_FORMAT },
    system: `以下の世界観資料を、TRPGのGMが必要な範囲だけ参照できるよう地域(region)・カテゴリ(category)に分割せよ。

世界観の規模に応じて、region・categoryの数は自由に決めてよい(小規模な世界観なら1〜2個程度でもよい)。`,
    messages: [
      {
        role: 'user',
        content: adjustmentRequest ? `${rawText}\n\n# 再分割の修正依頼\n${adjustmentRequest}` : rawText,
      },
    ],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    world: parsed.world,
    regions: dedupeIds((parsed.regions || []).map((r) => ({ ...r, id: slugify(r.id) }))),
    categories: dedupeIds((parsed.categories || []).map((c) => ({ ...c, id: slugify(c.id) }))),
  };
}
