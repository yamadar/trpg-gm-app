import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle, useGoogleFonts, motionAllowed, moodTheme } from './theme.js';
import { MOODS } from './constants/moods.js';

function FontProbe() {
  useGoogleFonts();
  return null;
}

beforeEach(() => {
  document.getElementById('trpg-fonts')?.remove();
});

describe('theme constants', () => {
  it('exposes color and font tokens', () => {
    expect(COLORS.ink).toBe('#1F2A38');
    expect(F_DISPLAY).toContain('Special Elite');
    expect(F_BODY).toContain('Source Serif 4');
    expect(F_MONO).toContain('IBM Plex Mono');
    expect(inputStyle.fontFamily).toBe(F_BODY);
  });
});

describe('motionAllowed', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('matchMediaが無い環境(jsdom)ではfalse=静的表示に倒す', () => {
    expect(motionAllowed()).toBe(false);
  });

  it('reduced-motion指定が無ければtrue', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(motionAllowed()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('prefers-reduced-motion: reduce ならfalse', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(motionAllowed()).toBe(false);
  });
});

describe('moodTheme', () => {
  it('moods未指定・空・未知のみは既定配色を返す', () => {
    const def = { paper: COLORS.paper, accent: COLORS.brass };
    expect(moodTheme(undefined)).toEqual(def);
    expect(moodTheme([])).toEqual(def);
    expect(moodTheme(['未知のジャンル'])).toEqual(def);
  });

  it('固定8種すべてに配色が定義されている', () => {
    for (const m of MOODS) {
      const t = moodTheme([m]);
      expect(t.paper).toMatch(/^#/);
      expect(t.accent).toMatch(/^#/);
    }
  });

  it('先頭の既知moodを優先する(未知が混ざっても飛ばす)', () => {
    expect(moodTheme(['未知', 'ホラー', '日常'])).toEqual(moodTheme(['ホラー']));
  });

  it('ホラーは既定と異なる紙色になる', () => {
    expect(moodTheme(['ホラー']).paper).not.toBe(COLORS.paper);
  });
});

describe('useGoogleFonts', () => {
  it('appends a stylesheet link to the document head once', () => {
    render(<FontProbe />);
    render(<FontProbe />);
    const links = document.head.querySelectorAll('#trpg-fonts');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toContain('fonts.googleapis.com');
  });
});
