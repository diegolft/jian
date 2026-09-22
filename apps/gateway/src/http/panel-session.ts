import type { FastifyReply, FastifyRequest } from 'fastify';
import { issuePanelSession, verifyPanelSession } from '../security/tokens.js';

const NAME = 'elos_panel';

/**
 * A cross-site request can carry the cookie, but a custom header forces a CORS preflight that
 * this gateway never answers. Requiring the header is what keeps the cookie useless off-origin.
 */
const HEADER = 'x-elos-panel';

/** `Secure` is set only over TLS: plain HTTP on a LAN is a supported self-hosted setup. */
function attributes(request: FastifyRequest, maxAgeSeconds: number) {
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(request.protocol === 'https' ? ['Secure'] : []),
  ].join('; ');
}

function cookieValue(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;

  if (!header || header.length > 4096) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');

    if (name === NAME) {
      return rest.join('=');
    }
  }

  return undefined;
}

export function authorizesPanel(request: FastifyRequest, secret: string): boolean {
  const value = cookieValue(request);

  return (
    request.headers[HEADER] === '1' && value !== undefined && verifyPanelSession(secret, value)
  );
}

export function openPanelSession(request: FastifyRequest, reply: FastifyReply, secret: string) {
  const session = issuePanelSession(secret);

  reply.header(
    'set-cookie',
    `${NAME}=${session.value}; ${attributes(request, session.maxAgeSeconds)}`,
  );

  return { expiresAt: new Date(session.expiresAt).toISOString() };
}

export function closePanelSession(request: FastifyRequest, reply: FastifyReply) {
  reply.header('set-cookie', `${NAME}=; ${attributes(request, 0)}`);

  return { ended: true as const };
}
