import { createHash, randomUUID } from 'node:crypto';
import { channelInputSchema, type channelSchema, type deliverySchema } from '@elos/contracts';
import type { z } from 'zod';
import type { ChannelRequest, DeliveryOutcome, IncomingMessage } from '../channels/channel.js';
import { ChannelRegistry } from '../channels/registry.js';
import { assertFound, GatewayError } from '../core/errors.js';
import type { Gateway } from '../gateway.js';
import { issueToken, verifyToken } from '../security/tokens.js';
import type { Credentials } from './credentials.js';

export type ChannelRecord = z.infer<typeof channelSchema> & { tokenHash: string };

export type DeliveryRecord = z.infer<typeof deliverySchema> & { connectionGeneration?: number };

const DISPATCH_INTERVAL_MS = 2000;
const UNCERTAIN_DELIVERY_AFTER_MS = 10 * 60_000;

/** Owns access checks and durable delivery state, independently of each protocol adapter. */
export class Channels {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly abort = new AbortController();

  constructor(
    private readonly gateway: Gateway,
    private readonly credentials: Credentials,
    private readonly fetcher: typeof fetch,
    private readonly registry = new ChannelRegistry(),
  ) {}

  start() {
    const tick = async () => {
      if (this.stopped) {
        return;
      }

      this.pending = this.dispatch().catch(() => console.error('elos: channel dispatch failed'));
      await this.pending;

      if (!this.stopped) {
        this.timer = setTimeout(tick, DISPATCH_INTERVAL_MS);
        this.timer.unref();
      }
    };

    void tick();
  }

  async stop() {
    this.stopped = true;
    this.abort.abort();
    clearTimeout(this.timer);
    await this.pending;
  }

  async create(profileId: string, input: unknown) {
    const data = channelInputSchema.parse(input);

    await this.gateway.session(profileId, data.sessionId);

    const adapter = this.registry.get(data.type);

    adapter.validateConfiguration?.(data);

    if (data.credentialId) {
      await this.credentials.resolve(profileId, data.credentialId, 'channel');
    }

    const issued = issueToken();

    const record: ChannelRecord = {
      ...data,
      id: randomUUID(),
      profileId,
      tokenHash: issued.hash,
      createdAt: new Date().toISOString(),
    };

    await this.gateway.store.transaction(profileId, async (tx) => {
      await tx.put('channel', record.id, profileId, record);

      await tx.event({
        profileId,
        type: 'channel.created',
        data: { id: record.id, type: record.type },
        createdAt: record.createdAt,
      });
    });

    const { tokenHash: _hash, ...metadata } = record;

    return { ...metadata, webhookToken: issued.token };
  }

  async list(profileId: string) {
    await this.gateway.profile(profileId);

    return (await this.gateway.store.list('channel', { profileId })).map(
      ({ tokenHash: _hash, ...metadata }) => metadata,
    );
  }

  async revoke(profileId: string, id: string) {
    return this.gateway.store.transaction(profileId, async (tx) => {
      const value = await tx.get('channel', id);
      const channel = assertFound(value?.profileId === profileId ? value : null, 'Channel');
      const record = { ...channel, revokedAt: new Date().toISOString() };

      await tx.put('channel', id, profileId, record);

      const connection = await tx.get('channelConnection', id);

      if (connection) {
        // Revocation also invalidates linked-device callbacks and removes the recoverable session.
        await tx.put('channelConnection', id, profileId, {
          id,
          profileId,
          desired: false,
          generation: connection.generation + 1,
          status: 'disconnected',
          updatedAt: record.revokedAt,
        });
        await tx.put('channelAuth', id, profileId, { id, profileId, chunks: [] });
      }

      const { tokenHash: _hash, ...metadata } = record;

      return metadata;
    });
  }

  async receive(id: string, request: ChannelRequest) {
    const adapter = this.registry.get(request.type);
    if (!adapter.webhookHeader) {
      throw new GatewayError(401, 'Channel does not accept webhooks');
    }

    const token = request.headers[adapter.webhookHeader];
    const channel = await this.gateway.store.get('channel', id);

    if (
      !channel ||
      channel.revokedAt ||
      typeof token !== 'string' ||
      token.length > 512 ||
      !verifyToken(token, channel.tokenHash)
    ) {
      throw new GatewayError(401, 'Unauthorized');
    }

    if (channel.type !== adapter.type) {
      throw new GatewayError(400, 'Channel type mismatch');
    }

    const data = adapter.receive(request.payload);

    if (!data) {
      return { accepted: false, runId: undefined };
    }

    return this.accept(channel, data);
  }

  /** Called only by the worker that owns an authenticated linked-device connection. */
  async receiveLinked(id: string, input: unknown, generation: number) {
    const channel = assertFound(await this.gateway.store.get('channel', id), 'Channel');
    const adapter = this.registry.get(channel.type);

    const connection = await this.gateway.store.get('channelConnection', id);

    if (
      channel.revokedAt ||
      adapter.webhookHeader ||
      !connection?.desired ||
      connection.generation !== generation
    ) {
      throw new GatewayError(403, 'Linked channel unavailable');
    }

    const data = adapter.receive(input);

    if (!data) {
      return { accepted: false, runId: undefined };
    }

    return this.accept(channel, data, generation);
  }

  private async accept(
    channel: ChannelRecord,
    data: IncomingMessage,
    connectionGeneration?: number,
  ) {
    const id = channel.id;
    const adapter = this.registry.get(channel.type);

    if (!channel.actorIds.includes(data.actorId) || !channel.chatIds.includes(data.chatId)) {
      throw new GatewayError(403, 'Channel actor or chat is not permitted');
    }

    // The binding, not the inbound payload, chooses the profile and session.
    const run = await this.gateway.submit(
      channel.profileId,
      channel.sessionId,
      {
        text: data.text,
        requestKey: createHash('sha256')
          .update(JSON.stringify([id, data.chatId, data.actorId, data.requestKey]))
          .digest('hex'),
      },
      undefined,
      'channel',
    );

    if (adapter.send) {
      await this.gateway.store.transaction(channel.profileId, async (tx) => {
        if (await tx.get('delivery', run.id)) {
          return;
        }

        const now = new Date().toISOString();

        await tx.put('delivery', run.id, channel.profileId, {
          id: run.id,
          runId: run.id,
          profileId: channel.profileId,
          channelId: id,
          chatId: data.chatId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          remoteMessageIds: [],
          connectionGeneration,
        });
      });
    }

    return { accepted: true, runId: run.id };
  }

  async deliveries(profileId: string) {
    await this.gateway.profile(profileId);

    return this.gateway.store.list('delivery', { profileId, limit: 100, descending: true });
  }

  async dispatch() {
    await this.recoverUncertainDeliveries();

    const deliveries = await this.gateway.store.list('delivery', {
      where: { status: 'pending' },
      limit: 20,
    });

    for (const delivery of deliveries) {
      if (this.stopped) {
        return;
      }

      const run = await this.gateway.run(delivery.profileId, delivery.runId);

      if (run.status === 'queued' || run.status === 'running') {
        continue;
      }

      const channel = await this.gateway.store.get('channel', delivery.channelId);
      const adapter = channel ? this.registry.get(channel.type) : undefined;

      const generationChanged =
        delivery.connectionGeneration !== undefined &&
        (await this.gateway.store.get('channelConnection', delivery.channelId))?.generation !==
          delivery.connectionGeneration;

      // A linked device can only send from its owning worker. Offline deliveries stay pending.
      if (
        !generationChanged &&
        channel &&
        !channel.revokedAt &&
        adapter?.canSend &&
        !(await adapter.canSend(channel.id))
      ) {
        continue;
      }

      if (!(await this.claimDelivery(delivery))) {
        continue;
      }

      const text =
        run.output ?? 'The agent could not complete this request. Check the gateway for details.';
      const outcome = await this.deliver(delivery, text);

      await this.gateway.store.transaction(delivery.profileId, async (tx) => {
        const current = assertFound(await tx.get('delivery', delivery.id), 'Delivery');

        await tx.put('delivery', delivery.id, delivery.profileId, {
          ...current,
          ...outcome,
          updatedAt: new Date().toISOString(),
        });
      });
    }
  }

  private async claimDelivery(delivery: DeliveryRecord): Promise<boolean> {
    return this.gateway.store.transaction(delivery.profileId, async (tx) => {
      const current = await tx.get('delivery', delivery.id);

      if (current?.status !== 'pending') {
        return false;
      }

      // Persist intent before network I/O so another worker cannot send the same delivery.
      await tx.put('delivery', delivery.id, delivery.profileId, {
        ...current,
        status: 'sending',
        updatedAt: new Date().toISOString(),
      });

      return true;
    });
  }

  private async deliver(delivery: DeliveryRecord, text: string): Promise<DeliveryOutcome> {
    let attemptedSend = false;

    try {
      const channel = await this.gateway.store.get('channel', delivery.channelId);

      if (!channel || channel.revokedAt) {
        throw new Error('Channel unavailable');
      }

      if (delivery.connectionGeneration !== undefined) {
        const connection = await this.gateway.store.get('channelConnection', delivery.channelId);

        if (!connection?.desired || connection.generation !== delivery.connectionGeneration) {
          throw new Error('Delivery belongs to a disconnected device');
        }
      }

      const adapter = this.registry.get(channel.type);

      const credential = channel.credentialId
        ? await this.credentials.resolve(delivery.profileId, channel.credentialId, 'channel')
        : undefined;

      if (!adapter.send) {
        throw new Error('Channel does not support delivery');
      }

      attemptedSend = true;

      return await adapter.send(
        { chatId: delivery.chatId, text },
        {
          channelId: delivery.channelId,
          connectionGeneration: delivery.connectionGeneration,
          credential,
          fetch: this.fetcher,
          signal: this.abort.signal,
        },
      );
    } catch {
      // An unexpected adapter failure may happen after a remote write. Never retry it blindly.
      return { status: attemptedSend ? 'unknown' : 'failed', remoteMessageIds: [] };
    }
  }

  private async recoverUncertainDeliveries(): Promise<void> {
    const sending = await this.gateway.store.list('delivery', {
      where: { status: 'sending' },
      limit: 100,
    });

    for (const delivery of sending) {
      if (Date.parse(delivery.updatedAt) > Date.now() - UNCERTAIN_DELIVERY_AFTER_MS) {
        continue;
      }

      await this.gateway.store.transaction(delivery.profileId, async (tx) => {
        const current = await tx.get('delivery', delivery.id);

        // Recheck under the profile lock: another worker may have confirmed this delivery.
        if (
          current?.status === 'sending' &&
          Date.parse(current.updatedAt) <= Date.now() - UNCERTAIN_DELIVERY_AFTER_MS
        ) {
          await tx.put('delivery', current.id, current.profileId, {
            ...current,
            status: 'unknown',
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }
  }
}
