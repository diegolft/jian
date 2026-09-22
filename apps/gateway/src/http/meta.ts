import { createOpenAPI } from '@jian/contracts';
import type { FastifyInstance } from 'fastify';

/** Unauthenticated probes: liveness and the published contract. */
export function registerMetaRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok', service: 'jian' }));

  app.get('/openapi.json', async () => createOpenAPI());
}
