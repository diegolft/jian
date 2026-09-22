import type { FastifyInstance } from 'fastify';
import { GatewayError } from '../core/errors.js';
import type { ProfileParams } from '../http/params.js';
import type { CodexLogin } from './codex/login.js';
import type { ProviderAdmin } from './port.js';
import type { Providers } from './service.js';

type ProviderRouteServices = {
  providers: ProviderAdmin &
    Pick<Providers, 'createProvider' | 'revokeProvider' | 'modelDefaults' | 'setModelDefaults'>;
  codexLogin?: CodexLogin;
};

export function registerProviderRoutes(app: FastifyInstance, deps: ProviderRouteServices): void {
  function codexLogin() {
    if (!deps.codexLogin) {
      throw new GatewayError(503, 'Codex login is unavailable');
    }

    return deps.codexLogin;
  }

  app.post<{ Params: ProfileParams }>(
    '/v1/profiles/:profileId/providers/openai/oauth',
    async (request) => codexLogin().start(request.params.profileId),
  );

  app.get<{ Params: ProfileParams }>(
    '/v1/profiles/:profileId/providers/openai/oauth',
    async (request) => codexLogin().status(request.params.profileId),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/providers', async (request) =>
    deps.providers.providers(request.params.profileId),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/providers', async (request, reply) =>
    reply
      .code(201)
      .send(await deps.providers.createProvider(request.params.profileId, request.body)),
  );

  app.delete<{ Params: ProfileParams & { providerId: string } }>(
    '/v1/profiles/:profileId/providers/:providerId',
    async (request) =>
      deps.providers.revokeProvider(request.params.profileId, request.params.providerId),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/model-defaults', async (request) =>
    deps.providers.modelDefaults(request.params.profileId),
  );

  app.put<{ Params: ProfileParams }>('/v1/profiles/:profileId/model-defaults', async (request) =>
    deps.providers.setModelDefaults(request.params.profileId, request.body),
  );
}
