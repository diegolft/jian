import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_TOKEN_LENGTH = 512;

export function hashToken(token: string): string {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[\x21-\x7e]+$/.test(token)
  ) {
    throw new Error('Invalid access token');
  }

  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueToken(): { token: string; hash: string; prefix: string } {
  const token = `elos_${randomBytes(32).toString('base64url')}`;

  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

export function verifyToken(token: string, hash: string): boolean {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}
