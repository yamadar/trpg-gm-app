import crypto from 'node:crypto';

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function codeChallengeS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
