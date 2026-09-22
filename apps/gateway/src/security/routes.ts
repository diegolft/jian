import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { GatewayError } from '../core/errors.js';
import { closePanelSession, openPanelSession } from './panel-session.js';

export function registerSecurityRoutes(app: FastifyInstance, deps: { token: string }): void {
  app.post(
    '/v1/panel/session',
    // Tighter than the global ceiling: this is the one route that accepts the host token.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const supplied = Buffer.from((request.body as { token: string }).token);
      const expected = Buffer.from(deps.token);

      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new GatewayError(401, 'Unauthorized');
      }

      return reply.code(201).send(openPanelSession(request, reply, deps.token));
    },
  );

  app.delete('/v1/panel/session', async (request, reply) => closePanelSession(request, reply));
}
