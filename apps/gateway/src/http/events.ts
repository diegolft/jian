import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GatewayError } from '../core/errors.js';
import type { Gateway } from '../gateway.js';
import type { Credentials } from '../services/credentials.js';

type ProfileParams = { profileId: string };

interface EventOptions {
  gateway: Gateway;
  token: string;
  credentials?: Credentials;
  maxStreams?: number;
}

/** Each connection owns its cursor; durable events survive disconnects and worker restarts. */
export function registerEventRoutes(app: FastifyInstance, options: EventOptions) {
  const gateway = options.gateway;
  let streams = 0;
  const cursorSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

  app.get<{ Params: ProfileParams; Querystring: { after?: string } }>(
    '/v1/profiles/:profileId/events',
    async (request) => {
      await gateway.profile(request.params.profileId);

      return gateway.store.events(
        request.params.profileId,
        cursorSchema.parse(request.query.after ?? 0),
      );
    },
  );

  app.get<{ Params: ProfileParams; Querystring: { after?: string } }>(
    '/v1/profiles/:profileId/events/stream',
    async (request, reply) => {
      const profileId = request.params.profileId;

      await gateway.profile(profileId);

      let cursor = cursorSchema.parse(request.headers['last-event-id'] ?? request.query.after ?? 0);

      if (streams >= (options.maxStreams ?? 100)) {
        throw new GatewayError(429, 'Too many event streams');
      }

      streams += 1;
      reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      reply.raw.write(': connected\n\n');

      let closed = false;
      let timer: ReturnType<typeof setTimeout>;

      reply.raw.on('close', () => {
        closed = true;
        streams -= 1;
        clearTimeout(timer);
      });

      const pump = async () => {
        if (closed) {
          return;
        }

        try {
          // Close slow consumers instead of buffering an unbounded event history.
          if (reply.raw.writableLength > 256 * 1024) {
            reply.raw.end();

            return;
          }

          // Long-lived streams must stop after their access key expires or is revoked.
          if (options.credentials && request.headers.authorization !== `Bearer ${options.token}`) {
            await options.credentials.authorize(
              (request.headers.authorization ?? '').slice(7),
              profileId,
              'read',
            );
          }

          if (reply.raw.writableNeedDrain) {
            timer = setTimeout(pump, 1000);
            timer.unref();

            return;
          }

          const events = await gateway.store.events(profileId, cursor);

          for (const event of events) {
            if (closed) {
              return;
            }

            const ready = reply.raw.write(
              `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );

            cursor = event.id;

            if (!ready) {
              break;
            }
          }

          if (events.length === 0) {
            reply.raw.write(': heartbeat\n\n');
          }
        } catch {
          reply.raw.end();

          return;
        }

        timer = setTimeout(pump, 1000);
        timer.unref();
      };

      void pump();
    },
  );
}
