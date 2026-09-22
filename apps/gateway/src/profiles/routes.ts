import type { FastifyInstance, FastifyRequest } from 'fastify';
import { GatewayError } from '../core/errors.js';
import type { ProfileParams } from '../http/params.js';
import type { ProfileAdmin } from './port.js';
import type { Profiles } from './service.js';

type ProfileRouteServices = {
  profiles: ProfileAdmin & Pick<Profiles, 'revisions'>;
  isScopedRequest: (request: FastifyRequest) => boolean;
};

export function registerProfileRoutes(app: FastifyInstance, deps: ProfileRouteServices): void {
  app.get('/v1/profiles', async () => deps.profiles.profiles());

  app.post('/v1/profiles', async (request, reply) =>
    reply.code(201).send(await deps.profiles.createProfile(request.body)),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId', async (request) =>
    deps.profiles.profile(request.params.profileId),
  );

  app.patch<{ Params: ProfileParams }>('/v1/profiles/:profileId', async (request) => {
    if (deps.isScopedRequest(request)) {
      const body = request.body as Record<string, unknown>;

      if (['model', 'mcpServers', 'allowSelfManagement'].some((key) => key in body)) {
        throw new GatewayError(403, 'Only an administrator can change capability grants');
      }
    }

    return deps.profiles.updateProfile(request.params.profileId, request.body);
  });

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/revisions', async (request) =>
    deps.profiles.revisions(request.params.profileId),
  );
}
