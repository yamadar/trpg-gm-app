import { describe, it, expect, vi, afterEach } from 'vitest';
import { rollD100, evaluateRoll } from './dice.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rollD100', () => {
  it('returns 1 when Math.random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(rollD100()).toBe(1);
  });

  it('returns 100 when Math.random returns just under 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(rollD100()).toBe(100);
  });
});

describe('evaluateRoll', () => {
  it('clamps successPercent into [1, 99]', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(evaluateRoll(150).success_percent).toBe(99);
    expect(evaluateRoll(0).success_percent).toBe(1);
  });

  it('is a success when the roll is at or below the success percent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.49); // roll = 50
    const result = evaluateRoll(60);
    expect(result.roll).toBe(50);
    expect(result.success).toBe(true);
    expect(result.degree).toBe('success');
  });

  it('is a fail when the roll exceeds the success percent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.79); // roll = 80
    const result = evaluateRoll(60);
    expect(result.success).toBe(false);
    expect(result.degree).toBe('fail');
  });

  it('is a critical when the roll is within 5% of the success percent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // roll = 1
    const result = evaluateRoll(60); // critical threshold = round(60*0.05) = 3
    expect(result.degree).toBe('critical');
  });

  it('is a fumble when the roll is 96 or higher', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.96); // roll = 97
    const result = evaluateRoll(60);
    expect(result.degree).toBe('fumble');
  });

  it('does not label a successful roll as a fumble at high success percents', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.96); // roll = 97
    const result = evaluateRoll(100); // clamped to 99, so 97 <= 99 → success
    expect(result.success).toBe(true);
    expect(result.degree).toBe('success');
  });

  it('labels a failing high roll as a fumble', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.96); // roll = 97
    const result = evaluateRoll(50);
    expect(result.success).toBe(false);
    expect(result.degree).toBe('fumble');
  });

  it('falls back to a neutral 50 when successPercent is not a finite number', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.49); // roll = 50
    const result = evaluateRoll(undefined);
    expect(result.success_percent).toBe(50);
    expect(result.success).toBe(true);
    expect(Number.isNaN(result.success_percent)).toBe(false);
  });
});
