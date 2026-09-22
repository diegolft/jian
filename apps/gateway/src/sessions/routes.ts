import type { FastifyInstance } from 'fastify';
import type { ProfileParams, SessionParams } from '../http/params.js';
import type { RunWriter } from '../runs/port.js';
import type { Coordination } from '../services/coordination.js';
import type { SessionWriter } from './port.js';

type SessionRouteServices = {
  sessions: SessionWriter;
  runs: RunWriter;
  // History spans every message of a profile or a session, so it comes from coordination.
  coordination: Pick<Coordination, 'history'>;
};

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteServices): void {
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/sessions', async (request) =>
    deps.sessions.sessions(request.params.profileId),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/sessions', async (request, reply) =>
    reply.code(201).send(await deps.sessions.createSession(request.params.profileId, request.body)),
  );

  app.get<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/messages',
    async (request) => deps.sessions.messages(request.params.profileId, request.params.sessionId),
  );

  app.post<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/messages',
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await deps.runs.submit(request.params.profileId, request.params.sessionId, request.body),
        ),
  );

  app.get<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/history',
    async (request) =>
      deps.coordination.history(request.params.profileId, request.params.sessionId, request.query),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/history', async (request) =>
    deps.coordination.history(request.params.profileId, undefined, request.query),
  );
}
