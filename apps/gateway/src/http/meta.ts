import { createOpenAPI } from '@elos/contracts';
import type { FastifyInstance } from 'fastify';

/** Unauthenticated probes: liveness and the published contract. */
export function registerMetaRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok', service: 'elos' }));

  app.get('/openapi.json', async () => createOpenAPI());
}
