import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitWorld } from './worldSplit.js';
import * as client from './client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('splitWorld', () => {
  it('parses the split result from the model response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [{ id: 'waterdeep', title: 'ウォーターディープ', content: '詳細' }],
            categories: [{ id: 'magic-system', title: '魔法体系', content: '詳細' }],
          }),
        },
      ],
    });
    const result = await splitWorld('長い世界観テキスト');
    expect(result.world).toBe('目次');
    expect(result.regions).toEqual([{ id: 'waterdeep', title: 'ウォーターディープ', content: '詳細' }]);
    expect(result.categories).toEqual([{ id: 'magic-system', title: '魔法体系', content: '詳細' }]);
  });

  it('slugifies a region id containing spaces and punctuation', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [{ id: 'Water Deep!', title: 'A', content: 'x' }],
            categories: [],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions[0].id).toBe('waterdeep');
  });

  it('falls back to "untitled" when a category id has no ascii characters after slugifying', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [],
            categories: [{ id: '魔法体系', title: 'B', content: 'y' }],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.categories[0].id).toBe('untitled');
  });

  it('includes the adjustment request in the prompt when provided', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ world: 'x', regions: [], categories: [] }) }],
    });
    await splitWorld('原文', '海沿いの街を追加してほしい');
    const sentMessage = callClaudeMock.mock.calls[0][0].messages[0].content;
    expect(sentMessage).toContain('原文');
    expect(sentMessage).toContain('海沿いの街を追加してほしい');
  });

  it('defaults regions and categories to empty arrays when missing from the response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ world: 'x' }) }],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions).toEqual([]);
    expect(result.categories).toEqual([]);
  });

  it('dedupes two region ids that both slugify to "untitled" instead of dropping one', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [
              { id: '魔法体系', title: 'A', content: 'x' },
              { id: '宗教', title: 'B', content: 'y' },
            ],
            categories: [],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions).toHaveLength(2);
    expect(result.regions.map((r) => r.id)).toEqual(['untitled', 'untitled-2']);
    expect(result.regions[0].title).toBe('A');
    expect(result.regions[1].title).toBe('B');
  });

  it('re-dedupes against emitted ids when a collision id already matches an original id', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [
              { id: '魔法体系', title: 'A', content: 'x' },
              { id: '宗教', title: 'B', content: 'y' },
              { id: 'Untitled-2', title: 'C', content: 'z' },
            ],
            categories: [],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions).toHaveLength(3);
    const ids = result.regions.map((r) => r.id);
    expect(ids).toEqual(['untitled', 'untitled-2', 'untitled-2-2']);
    expect(new Set(ids).size).toBe(3);
    expect(result.regions.find((r) => r.id === 'untitled').title).toBe('A');
    expect(result.regions.find((r) => r.id === 'untitled').content).toBe('x');
    expect(result.regions.find((r) => r.id === 'untitled-2').title).toBe('B');
    expect(result.regions.find((r) => r.id === 'untitled-2').content).toBe('y');
    expect(result.regions.find((r) => r.id === 'untitled-2-2').title).toBe('C');
    expect(result.regions.find((r) => r.id === 'untitled-2-2').content).toBe('z');
  });

  it('allows a region and a category to share the same slugified id without renaming either', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [{ id: 'waterdeep', title: 'A', content: 'x' }],
            categories: [{ id: 'waterdeep', title: 'B', content: 'y' }],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions[0].id).toBe('waterdeep');
    expect(result.categories[0].id).toBe('waterdeep');
  });
});
