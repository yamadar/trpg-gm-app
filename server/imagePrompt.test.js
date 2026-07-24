// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildImagePrompt, buildPortraitPrompt } from './imagePrompt.js';

describe('buildImagePrompt', () => {
  it('includes the base style and a mood-specific keyword', () => {
    const p = buildImagePrompt({ narrative: '城', moods: ['ホラー'] });
    expect(p).toContain('digital illustration');
    expect(p).toContain('horror');
    expect(p).toContain('場面: 城');
  });
  it('falls back to a neutral tone for unknown/empty moods', () => {
    expect(buildImagePrompt({ narrative: 'x', moods: [] })).toContain('neutral');
    expect(buildImagePrompt({ narrative: 'x', moods: ['未知'] })).toContain('neutral');
  });
  it('injects only the provided character appearances', () => {
    const p = buildImagePrompt({ narrative: 'x', moods: [], appearances: [{ name: 'カイ', description: '赤髪の猟師' }] });
    expect(p).toContain('登場人物: カイ=赤髪の猟師');
  });
  it('trims long narrative to 400 chars', () => {
    const long = 'あ'.repeat(500);
    const p = buildImagePrompt({ narrative: long, moods: [] });
    expect(p).toContain('あ'.repeat(400));
    expect(p).not.toContain('あ'.repeat(401));
  });
  it('does not throw on empty inputs', () => {
    expect(() => buildImagePrompt({})).not.toThrow();
  });
});

describe('buildPortraitPrompt', () => {
  it('バストアップ・無地背景・mood画風・人物記述を含む', () => {
    const p = buildPortraitPrompt({ name: 'カイ', description: '赤髪の猟師', moods: ['ホラー'] });
    expect(p).toContain('bust shot');
    expect(p).toContain('plain background');
    expect(p).toContain('horror');
    expect(p).toContain('人物: カイ=赤髪の猟師');
  });
  it('空入力で例外を投げない', () => {
    expect(() => buildPortraitPrompt({})).not.toThrow();
  });
});

describe('buildImagePrompt hasReferences', () => {
  it('hasReferences時のみ参照維持の指示を含む', () => {
    const base = { narrative: 'x', moods: [], appearances: [] };
    expect(buildImagePrompt({ ...base, hasReferences: true })).toContain('厳密に維持');
    expect(buildImagePrompt(base)).not.toContain('厳密に維持');
  });
});
