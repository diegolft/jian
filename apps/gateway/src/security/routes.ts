import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { GatewayError } from '../core/errors.js';
import type { CredentialParams, KeyParams, ProfileParams } from '../http/params.js';
import type { Credentials } from './credentials.js';
import { closePanelSession, openPanelSession } from './panel-session.js';

type SecurityRouteServices = {
  token: string;
  credentials?: Credentials;
};

export function registerSecurityRoutes(app: FastifyInstance, deps: SecurityRouteServices): void {
  function vault() {
    if (!deps.credentials) {
      throw new GatewayError(503, 'Credential vault is not configured');
    }

    return deps.credentials;
  }

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

  app.post<{ Params: ProfileParams }>(
    '/v1/profiles/:profileId/credentials',
    async (request, reply) =>
      reply.code(201).send(await vault().create(request.params.profileId, request.body)),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/credentials', async (request) =>
    vault().list(request.params.profileId),
  );

  app.delete<{ Params: CredentialParams }>(
    '/v1/profiles/:profileId/credentials/:credentialId',
    async (request) => vault().revoke(request.params.profileId, request.params.credentialId),
  );

  app.post<{ Params: CredentialParams }>(
    '/v1/profiles/:profileId/credentials/:credentialId/rotate',
    async (request) => vault().rotate(request.params.profileId, request.params.credentialId),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/keys', async (request, reply) =>
    reply.code(201).send(await vault().issueKey(request.params.profileId, request.body)),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/keys', async (request) =>
    vault().keys(request.params.profileId),
  );

  app.delete<{ Params: KeyParams }>('/v1/profiles/:profileId/keys/:keyId', async (request) =>
    vault().revokeKey(request.params.profileId, request.params.keyId),
  );
}
