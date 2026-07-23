// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { randomToken, sha256hex, codeChallengeS256 } from './crypto.js';

describe('auth crypto utils', () => {
  it('randomToken returns unique url-safe tokens', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('sha256hex returns a stable 64-char hex digest', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('codeChallengeS256 matches RFC7636 appendix B example', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});
