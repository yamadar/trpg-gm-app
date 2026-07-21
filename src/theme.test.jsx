import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle, useGoogleFonts } from './theme.js';

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

describe('useGoogleFonts', () => {
  it('appends a stylesheet link to the document head once', () => {
    render(<FontProbe />);
    render(<FontProbe />);
    const links = document.head.querySelectorAll('#trpg-fonts');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toContain('fonts.googleapis.com');
  });
});
