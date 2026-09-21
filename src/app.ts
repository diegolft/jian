import { timingSafeEqual } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import { z, ZodError } from 'zod';
import { GatewayError } from './domain.js';
import type { Gateway } from './gateway.js';

export function createApp(options: { gateway: Gateway; token: string; logger?: boolean; onCancel?: (runId: string) => void }) {
  if (options.token.length < 32) throw new Error('ELOS_API_TOKEN must have at least 32 characters');
  const gateway = options.gateway;
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 256 * 1024, logController: new LogController({ disableRequestLogging: true }) });
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === '/health') return;
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send({ error: 'Unauthorized' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (error instanceof GatewayError) return reply.code(error.statusCode).send({ error: error.message });
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500) return reply.code(status).send({ error: 'Invalid request' });
    app.log.error({ event: 'request.failed' }, 'Request failed');
    return reply.code(500).send({ error: 'Internal server error' });
  });
  type ProfileParams = { profileId: string };
  type SessionParams = ProfileParams & { sessionId: string };
  type RunParams = ProfileParams & { runId: string };
  app.get('/health', async () => ({ status: 'ok', service: 'elos' }));
  app.get('/v1/profiles', async () => gateway.profiles());
  app.post('/v1/profiles', async (request, reply) => reply.code(201).send(await gateway.createProfile(request.body)));
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId', async request => gateway.profile(request.params.profileId));
  app.patch<{ Params: ProfileParams }>('/v1/profiles/:profileId', async request => gateway.updateProfile(request.params.profileId, request.body));
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/revisions', async request => gateway.revisions(request.params.profileId));
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/sessions', async request => gateway.sessions(request.params.profileId));
  app.post<{ Params: ProfileParams }>('/v1/profiles/:profileId/sessions', async (request, reply) => reply.code(201).send(await gateway.createSession(request.params.profileId, request.body)));
  app.get<{ Params: SessionParams }>('/v1/profiles/:profileId/sessions/:sessionId/messages', async request => gateway.messages(request.params.profileId, request.params.sessionId));
  app.post<{ Params: SessionParams }>('/v1/profiles/:profileId/sessions/:sessionId/messages', async (request, reply) => reply.code(202).send(await gateway.submit(request.params.profileId, request.params.sessionId, request.body)));
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async request => gateway.memories(request.params.profileId));
  app.put<{ Params: ProfileParams }>('/v1/profiles/:profileId/memories', async request => gateway.remember(request.params.profileId, request.body));
  app.get<{ Params: ProfileParams }>('/v1/profiles/:profileId/activities', async request => gateway.activities(request.params.profileId));
  app.get<{ Params: RunParams }>('/v1/profiles/:profileId/runs/:runId', async request => gateway.run(request.params.profileId, request.params.runId));
  app.post<{ Params: RunParams }>('/v1/profiles/:profileId/runs/:runId/cancel', async request => {
    const result = await gateway.cancel(request.params.profileId, request.params.runId); options.onCancel?.(result.id); return result;
  });
  const cursorSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  app.get<{ Params: ProfileParams; Querystring: { after?: string } }>('/v1/profiles/:profileId/events', async request => {
    await gateway.profile(request.params.profileId);
    return gateway.store.events(request.params.profileId, cursorSchema.parse(request.query.after ?? 0));
  });
  app.get<{ Params: ProfileParams; Querystring: { after?: string } }>('/v1/profiles/:profileId/events/stream', async (request, reply) => {
    const profileId = request.params.profileId;
    await gateway.profile(profileId);
    let cursor = cursorSchema.parse(request.headers['last-event-id'] ?? request.query.after ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(': connected\n\n');
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    reply.raw.on('close', () => { closed = true; clearTimeout(timer); });
    const pump = async () => {
      if (closed) return;
      try {
        const events = await gateway.store.events(profileId, cursor);
        for (const event of events) {
          if (closed) return;
          const ready = reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.id;
          if (!ready) break;
        }
        if (events.length === 0) reply.raw.write(': heartbeat\n\n');
      } catch { reply.raw.end(); return; }
      timer = setTimeout(pump, 1000); timer.unref();
    };
    void pump();
  });
  return app;
}
