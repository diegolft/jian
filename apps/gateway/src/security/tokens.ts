import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

/** Thirty days: long enough that the owner stops pasting the host token, short enough to lapse. */
const PANEL_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PANEL_COOKIE = /^(\d{13,15})\.([A-Za-z0-9_-]{43})$/;

function signPanelSession(secret: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(`panel:${expiresAt}`).digest('base64url');
}

/**
 * The cookie carries only its own expiry and a signature over it, keyed by the host token.
 * Nothing is stored server-side, and rotating the host token invalidates every open panel.
 */
export function issuePanelSession(
  secret: string,
  now = Date.now(),
): { value: string; expiresAt: number; maxAgeSeconds: number } {
  const expiresAt = now + PANEL_SESSION_MS;

  return {
    value: `${expiresAt}.${signPanelSession(secret, expiresAt)}`,
    expiresAt,
    maxAgeSeconds: Math.floor(PANEL_SESSION_MS / 1000),
  };
}

export function verifyPanelSession(secret: string, value: string, now = Date.now()): boolean {
  const match = PANEL_COOKIE.exec(value);

  if (!match) {
    return false;
  }

  const expiresAt = Number(match[1]);

  try {
    if (
      !timingSafeEqual(
        Buffer.from(signPanelSession(secret, expiresAt), 'base64url'),
        Buffer.from(match[2] as string, 'base64url'),
      )
    ) {
      return false;
    }
  } catch {
    return false;
  }

  // Checked after the signature so an unsigned guess learns nothing from the timing.
  return expiresAt > now && expiresAt <= now + PANEL_SESSION_MS;
}
