import { timingSafeEqual } from 'node:crypto';
import { operations } from '@elos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { GatewayError } from '../domain.js';
import type { Credentials } from '../services/credentials.js';

interface SecurityOptions {
  token: string;
  credentials?: Credentials;
}

/** Unknown routes require admin access; webhook adapters authenticate their own secrets. */
export function configureSecurity(app: FastifyInstance, options: SecurityOptions) {
  const scopedRequests = new WeakSet<FastifyRequest>();

  app.addHook('onRequest', async (request, reply) => {
    // Only the static-file plugin sets this flag; API routes still require bearer authentication.
    if (request.routeOptions.config.publicUiAsset && ['GET', 'HEAD'].includes(request.method)) {
      return;
    }

    const operation = operations.find(
      (item) => item.path === request.routeOptions.url && item.method === request.method,
    );

    if (operation?.scope === 'public' || operation?.scope === 'webhook') {
      return;
    }

    const authorization = request.headers.authorization ?? '';

    if (authorization.length > 512) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const supplied = Buffer.from(authorization);
    const expected = Buffer.from(`Bearer ${options.token}`);

    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) {
      return;
    }

    if (!authorization.startsWith('Bearer ') || !options.credentials) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const profileId = (request.params as { profileId?: string }).profileId;

    await options.credentials.authorize(
      authorization.slice(7),
      profileId,
      operation?.scope ?? 'admin',
    );

    // A profile editor can change identity, but cannot delegate host authority.
    if (operation?.operationId === 'updateProfile') {
      scopedRequests.add(request);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    if (error instanceof GatewayError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;

    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'Invalid request' });
    }

    app.log.error({ event: 'request.failed' }, 'Request failed');

    return reply.code(500).send({ error: 'Internal server error' });
  });

  return { isScopedRequest: (request: FastifyRequest) => scopedRequests.has(request) };
}
