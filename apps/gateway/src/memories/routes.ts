import type { FastifyInstance } from 'fastify';
import type { ProfileParams } from '../http/params.js';
import type { MemoryWriter } from './port.js';

export function registerMemoryRoutes(app: FastifyInstance, deps: { memories: MemoryWriter }): void {
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async (request) =>
    deps.memories.memories(request.params.profileId),
  );

  app.put<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async (request) =>
    deps.memories.remember(request.params.profileId, request.body),
  );
}
