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
  it('人物へ場面に合う姿勢・視線・表情を指定し、棒立ちと無表情を避ける', () => {
    const p = buildImagePrompt({
      narrative: '敵の一撃をかわし、仲間へ叫ぶ',
      moods: [],
      appearances: [{ name: 'カイ', description: '赤髪の猟師' }],
    });
    expect(p).toContain('自然な動作中');
    expect(p).toContain('重心・手足・視線');
    expect(p).toContain('表情を場面の感情と緊張度に合わせる');
    expect(p).toContain('棒立ち');
    expect(p).toContain('無表情を避ける');
  });
  it('人物がいない風景へ人物を追加しない', () => {
    const p = buildImagePrompt({ narrative: '無人の廃墟', moods: [], appearances: [] });
    expect(p).toContain('人物を描く場合');
    expect(p).toContain('風景・物だけの場面へ人物を追加しない');
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
