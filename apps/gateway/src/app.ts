import { timingSafeEqual } from 'node:crypto';
import { createOpenAPI, operationSchema, operations } from '@elos/contracts';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import type { WhatsAppConnections } from './channels/whatsapp/connections.js';
import { GatewayError } from './core/errors.js';
import type { Gateway } from './gateway.js';
import { registerEventRoutes } from './http/events.js';
import { closePanelSession, openPanelSession } from './http/panel-session.js';
import { configureSecurity } from './http/security.js';
import { registerGatewayUi } from './http/ui.js';
import type { Channels } from './services/channels.js';
import type { CodexLogin } from './services/codex-login.js';
import { Coordination } from './services/coordination.js';
import type { Credentials } from './services/credentials.js';

export function createApp(options: {
  gateway: Gateway;
  token: string;
  logger?: boolean;
  credentials?: Credentials;
  codexLogin?: CodexLogin;
  channels?: Channels;
  whatsapp?: WhatsAppConnections;
  maxStreams?: number;
  uiRoot?: string;
  onCancel?: (runId: string) => void;
}) {
  if (options.token.length < 32) {
    throw new Error('ELOS_API_TOKEN must have at least 32 characters');
  }

  const gateway = options.gateway;
  const coordination = new Coordination(gateway);

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body',
              'res.headers.set-cookie',
            ],
          },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true } },
    requestTimeout: 30000,
    connectionTimeout: 30000,
    bodyLimit: 256 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });

  void app.register(helmet);
  void app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.addHook('onRoute', (route) => {
    const operation = operations.find(
      (item) => item.path === route.url && item.method === route.method,
    );

    if (operation) {
      route.schema = operationSchema(operation);
    }
  });

  const { isScopedRequest } = configureSecurity(app, options);

  type ProfileParams = { profileId: string };

  app.post<{ Params: ProfileParams }>(
    '/v1/profiles/:profileId/providers/openai/oauth',
    async (request) => {
      if (!options.codexLogin) throw new GatewayError(503, 'Codex login is unavailable');
      return options.codexLogin.start(request.params.profileId);
    },
  );
  app.get<{ Params: ProfileParams }>(
    '/v1/profiles/:profileId/providers/openai/oauth',
    async (request) => {
      if (!options.codexLogin) throw new GatewayError(503, 'Codex login is unavailable');
      return options.codexLogin.status(request.params.profileId);
    },
  );

  type SessionParams = ProfileParams & { sessionId: string };

  type RunParams = ProfileParams & { runId: string };

  app.get('/health', async () => ({ status: 'ok', service: 'elos' }));

  app.post(
    '/v1/panel/session',
    // Tighter than the global ceiling: this is the one route that accepts the host token.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const supplied = Buffer.from((request.body as { token: string }).token);
      const expected = Buffer.from(options.token);

      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new GatewayError(401, 'Unauthorized');
      }

      return reply.code(201).send(openPanelSession(request, reply, options.token));
    },
  );

  app.delete('/v1/panel/session', async (request, reply) => closePanelSession(request, reply));
  app.get('/v1/profiles', async () => gateway.profiles());

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/providers', async (request) =>
    gateway.providers(request.params.profileId),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/providers', async (request, reply) =>
    reply.code(201).send(await gateway.createProvider(request.params.profileId, request.body)),
  );

  app.delete<{ Params: ProfileParams & { providerId: string } }>(
    '/v1/profiles/:profileId/providers/:providerId',
    async (request) => gateway.revokeProvider(request.params.profileId, request.params.providerId),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/model-defaults', async (request) =>
    gateway.modelDefaults(request.params.profileId),
  );

  app.put<{ Params: ProfileParams }>('/v1/profiles/:profileId/model-defaults', async (request) =>
    gateway.setModelDefaults(request.params.profileId, request.body),
  );

  app.post('/v1/profiles', async (request, reply) =>
    reply.code(201).send(await gateway.createProfile(request.body)),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId', async (request) =>
    gateway.profile(request.params.profileId),
  );

  app.patch<{ Params: ProfileParams }>('/v1/profiles/:profileId', async (request) => {
    if (isScopedRequest(request)) {
      const body = request.body as Record<string, unknown>;

      if (['model', 'mcpServers', 'allowSelfManagement'].some((key) => key in body)) {
        throw new GatewayError(403, 'Only an administrator can change capability grants');
      }
    }

    return gateway.updateProfile(request.params.profileId, request.body);
  });

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/revisions', async (request) =>
    gateway.revisions(request.params.profileId),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/sessions', async (request) =>
    gateway.sessions(request.params.profileId),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/sessions', async (request, reply) =>
    reply.code(201).send(await gateway.createSession(request.params.profileId, request.body)),
  );

  app.get<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/messages',
    async (request) => gateway.messages(request.params.profileId, request.params.sessionId),
  );

  app.post<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/messages',
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await gateway.submit(request.params.profileId, request.params.sessionId, request.body),
        ),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async (request) =>
    gateway.memories(request.params.profileId),
  );

  app.put<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async (request) =>
    gateway.remember(request.params.profileId, request.body),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/activities', async (request) =>
    gateway.activities(request.params.profileId),
  );

  app.get<{ Params: RunParams }>('/v1/profiles/:profileId/runs/:runId', async (request) =>
    gateway.run(request.params.profileId, request.params.runId),
  );

  app.post<{ Params: RunParams }>('/v1/profiles/:profileId/runs/:runId/cancel', async (request) => {
    const result = await gateway.cancel(request.params.profileId, request.params.runId);

    options.onCancel?.(result.id);

    return result;
  });

  app.get<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/history',
    async (request) =>
      coordination.history(request.params.profileId, request.params.sessionId, request.query),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/history', async (request) =>
    coordination.history(request.params.profileId, undefined, request.query),
  );

  app.get<{ Params: ProfileParams & { artifactId: string } }>(
    '/v1/profiles/:profileId/artifacts/:artifactId',
    async (request) =>
      coordination.artifact(request.params.profileId, request.params.artifactId, request.query),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/leases', async (request) =>
    coordination.acquire(request.params.profileId, request.body),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/leases/release', async (request) =>
    coordination.release(request.params.profileId, request.body),
  );

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/mail', async (request) =>
    coordination.send(request.params.profileId, request.body),
  );

  app.get<{ Params: SessionParams }>(
    '/v1/profiles/:profileId/sessions/:sessionId/mail',
    async (request) => coordination.inbox(request.params.profileId, request.params.sessionId),
  );

  app.get<{ Params: RunParams }>(
    '/v1/profiles/:profileId/runs/:runId/checkpoints',
    async (request) => gateway.checkpoints(request.params.profileId, request.params.runId),
  );

  app.post<{ Params: RunParams }>(
    '/v1/profiles/:profileId/runs/:runId/continue',
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await gateway.continueRun(request.params.profileId, request.params.runId, request.body),
        ),
  );

  function channels() {
    if (!options.channels) {
      throw new GatewayError(503, 'Channels are not configured');
    }

    return options.channels;
  }

  type ChannelParams = ProfileParams & { channelId: string };

  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/channels', async (request, reply) =>
    reply.code(201).send(await channels().create(request.params.profileId, request.body)),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/channels', async (request) =>
    channels().list(request.params.profileId),
  );

  app.delete<{ Params: ChannelParams }>(
    '/v1/profiles/:profileId/channels/:channelId',
    async (request) => channels().revoke(request.params.profileId, request.params.channelId),
  );

  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/deliveries', async (request) =>
    channels().deliveries(request.params.profileId),
  );

  function linkedDevices() {
    if (!options.whatsapp) {
      throw new GatewayError(503, 'WhatsApp connections are not configured');
    }

    return options.whatsapp;
  }

  app.post<{ Params: ChannelParams }>(
    '/v1/profiles/:profileId/channels/:channelId/connect',
    async (request, reply) =>
      reply
        .code(202)
        .send(await linkedDevices().connect(request.params.profileId, request.params.channelId)),
  );

  app.get<{ Params: ChannelParams }>(
    '/v1/profiles/:profileId/channels/:channelId/connection',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return linkedDevices().status(request.params.profileId, request.params.channelId);
    },
  );

  app.get<{ Params: ChannelParams }>(
    '/v1/profiles/:profileId/channels/:channelId/qr',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return linkedDevices().qr(request.params.profileId, request.params.channelId);
    },
  );

  app.post<{ Params: ChannelParams }>(
    '/v1/profiles/:profileId/channels/:channelId/disconnect',
    async (request, reply) =>
      reply
        .code(202)
        .send(await linkedDevices().disconnect(request.params.profileId, request.params.channelId)),
  );

  app.post<{ Params: { channelId: string } }>('/v1/ingress/:channelId', async (request, reply) =>
    reply.code(202).send(
      await channels().receive(request.params.channelId, {
        type: 'generic',
        headers: request.headers,
        payload: request.body,
      }),
    ),
  );

  app.post<{ Params: { channelId: string } }>('/v1/telegram/:channelId', async (request) =>
    channels().receive(request.params.channelId, {
      type: 'telegram',
      headers: request.headers,
      payload: request.body,
    }),
  );

  function vault() {
    if (!options.credentials) {
      throw new GatewayError(503, 'Credential vault is not configured');
    }

    return options.credentials;
  }

  type CredentialParams = ProfileParams & { credentialId: string };

  type KeyParams = ProfileParams & { keyId: string };

  app.get('/openapi.json', async () => createOpenAPI());

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

  registerEventRoutes(app, options);

  registerGatewayUi(app, options.uiRoot);

  return app;
}
