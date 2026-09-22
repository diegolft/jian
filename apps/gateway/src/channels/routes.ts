import type { FastifyInstance } from 'fastify';
import { GatewayError } from '../core/errors.js';
import type { ChannelParams, ProfileParams } from '../http/params.js';
import type { Channels } from '../services/channels.js';
import type { WhatsAppConnections } from './whatsapp/connections.js';

type ChannelRouteServices = {
  channels?: Channels;
  whatsapp?: WhatsAppConnections;
};

export function registerChannelRoutes(app: FastifyInstance, deps: ChannelRouteServices): void {
  function channels() {
    if (!deps.channels) {
      throw new GatewayError(503, 'Channels are not configured');
    }

    return deps.channels;
  }

  function linkedDevices() {
    if (!deps.whatsapp) {
      throw new GatewayError(503, 'WhatsApp connections are not configured');
    }

    return deps.whatsapp;
  }

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
}
