import type { FastifyInstance } from 'fastify';
import type { ProfileParams, SessionParams } from '../http/params.js';
import type { Coordination } from '../services/coordination.js';

type CoordinationRouteServices = {
  coordination: Pick<Coordination, 'artifact' | 'acquire' | 'release' | 'send' | 'inbox'>;
};

export function registerCoordinationRoutes(
  app: FastifyInstance,
  deps: CoordinationRouteServices,
): void {
  app.get<{ Params: ProfileParams & { artifactId: string } }>(
    '/v1/profiles/:profileId/artifacts/:artifactId',
    async (request) =>
      deps.coordination.artifact(
        request.params.profileId,
        request.params.artifactId,
        request.query,
      ),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/leases', async (request) =>
    deps.coordination.acquire(request.params.profileId, request.body),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/leases/release', async (request) =>
    deps.coordination.release(request.params.profileId, request.body),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/mail', async (request) =>
    deps.coordination.send(request.params.profileId, request.body),
  );

  app.get<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/mail',
    async (request) => deps.coordination.inbox(request.params.profileId, request.params.sessionId),
  );
}
