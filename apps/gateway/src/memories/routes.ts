import type { FastifyInstance } from 'fastify';
import type { MemoryParams, ProfileParams } from '../http/params.js';
import type { MemoryWriter } from './port.js';

export function registerMemoryRoutes(app: FastifyInstance, deps: { memories: MemoryWriter }): void {
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async (request) =>
    deps.memories.memories(request.params.profileId),
  );

  app.delete<{ Params: MemoryParams }>(
    '/v1/profiles/:profileId/memories/:memoryKey',
    async (request) => deps.memories.forget(request.params.profileId, request.params.memoryKey),
  );
}
