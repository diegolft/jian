import { createHash, randomUUID } from 'node:crypto';
import { assertFound, GatewayError } from '../../core/errors.js';
import type { Transaction } from '../../core/store.js';
import type { Gateway } from '../../gateway.js';
import type { SecretBox } from '../../security/crypto.js';
import type { DeliveryOutcome, IncomingMessage, OutgoingMessage } from '../channel.js';
import type { ConnectionRecord, DeviceFactory, DeviceSessionStore, LinkedDevice } from './types.js';
import { DEVICE_SEND_TIMEOUT_MS } from './types.js';

const LEASE_MS = 30_000;
const QR_LIFETIME_MS = 45_000;
const AUTH_CHUNK_BYTES = 512 * 1024;
export const MAX_DEVICE_SESSION_BYTES = 64 * 1024 * 1024;

type Receiver = (id: string, input: IncomingMessage, generation: number) => Promise<unknown>;
type LocalDevice = { device: LinkedDevice; generation: number; fence: number };

/** Database leases keep API replicas independent from the worker that owns the browser. */
export class WhatsAppConnections {
  private readonly owner = randomUUID();
  private readonly devices = new Map<string, LocalDevice>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly gateway: Gateway,
    private readonly box: SecretBox,
    private readonly factory: DeviceFactory,
    private readonly clock = Date.now,
  ) {}

  private now() {
    return new Date(this.clock()).toISOString();
  }

  private async binding(profileId: string, id: string, tx = this.gateway.store) {
    const value = await tx.get('channel', id);
    const channel = assertFound(value?.profileId === profileId ? value : null, 'Channel');

    if (channel.type !== 'whatsapp' || channel.revokedAt) {
      throw new GatewayError(409, 'WhatsApp channel unavailable');
    }

    return channel;
  }

  async connect(profileId: string, id: string) {
    await this.binding(profileId, id);

    await this.gateway.store.transaction(profileId, async (tx) => {
      const current = await tx.get('channelConnection', id);

      if (current?.desired) {
        return;
      }

      await tx.put('channelConnection', id, profileId, {
        id,
        profileId,
        desired: true,
        generation: current?.generation ?? 1,
        fence: (current?.fence ?? 0) + 1,
        status: 'connecting',
        sessionSavedAt: current?.sessionSavedAt,
        accountId: current?.accountId,
        updatedAt: this.now(),
      });
    });

    return this.status(profileId, id);
  }

  async disconnect(profileId: string, id: string) {
    await this.binding(profileId, id);

    await this.gateway.store.transaction(profileId, async (tx) => {
      const current = await tx.get('channelConnection', id);

      // Incrementing the generation fences every callback and backup from the old browser.
      await tx.put('channelConnection', id, profileId, {
        id,
        profileId,
        desired: false,
        generation: (current?.generation ?? 0) + 1,
        status: 'disconnected',
        updatedAt: this.now(),
      });
      await tx.put('channelAuth', id, profileId, { id, profileId, chunks: [] });
    });

    return this.status(profileId, id);
  }

  async status(profileId: string, id: string) {
    await this.binding(profileId, id);
    const current = await this.gateway.store.get('channelConnection', id);
    const stale = current?.desired && (current.leaseUntil ?? 0) <= this.clock();

    return {
      channelId: id,
      status: stale ? ('connecting' as const) : (current?.status ?? ('disconnected' as const)),
      accountId: current?.accountId,
      sessionSavedAt: current?.sessionSavedAt,
      updatedAt: current?.updatedAt ?? this.now(),
      error: current?.error,
    };
  }

  async qr(profileId: string, id: string) {
    await this.binding(profileId, id);
    const current = await this.gateway.store.get('channelConnection', id);

    if (
      !current?.desired ||
      current.status !== 'qr' ||
      !current.qr ||
      (current.leaseUntil ?? 0) <= this.clock() ||
      (current.qrExpiresAt ?? 0) <= this.clock()
    ) {
      throw new GatewayError(409, 'No valid QR code is available');
    }

    return {
      qr: this.box.decrypt(current.qr, `elos:whatsapp:qr:${profileId}:${id}`),
      expiresAt: new Date(current.qrExpiresAt as number).toISOString(),
    };
  }

  private async owned(tx: Transaction, record: ConnectionRecord) {
    const current = await tx.get('channelConnection', record.id);
    const channel = await tx.get('channel', record.id);

    if (
      !current?.desired ||
      current.owner !== this.owner ||
      current.generation !== record.generation ||
      current.fence !== record.fence ||
      (current.leaseUntil ?? 0) <= this.clock() ||
      !channel ||
      channel.revokedAt
    ) {
      throw new GatewayError(409, 'Device ownership expired');
    }

    return current;
  }

  private async update(record: ConnectionRecord, patch: Partial<ConnectionRecord>) {
    await this.gateway.store.transaction(record.profileId, async (tx) => {
      const current = await this.owned(tx, record);
      await tx.put('channelConnection', record.id, record.profileId, {
        ...current,
        ...patch,
        updatedAt: this.now(),
      });
    });
  }

  private sessionStore(record: ConnectionRecord): DeviceSessionStore {
    const aad = (index: number, total: number) =>
      `elos:whatsapp:auth:${record.profileId}:${record.id}:${index}:${total}`;

    return {
      load: () =>
        this.gateway.store.transaction(record.profileId, async (tx) => {
          await this.owned(tx, record);
          const auth = await tx.get('channelAuth', record.id);

          if (!auth?.chunks.length) {
            return undefined;
          }

          return Buffer.concat(
            auth.chunks.map((chunk, index) =>
              Buffer.from(this.box.decrypt(chunk, aad(index, auth.chunks.length)), 'base64'),
            ),
          );
        }),
      save: async (data) => {
        if (!data.length || data.length > MAX_DEVICE_SESSION_BYTES) {
          throw new Error('Invalid device session size');
        }

        const total = Math.ceil(data.length / AUTH_CHUNK_BYTES);
        const chunks = Array.from({ length: total }, (_, index) =>
          this.box.encrypt(
            data
              .subarray(index * AUTH_CHUNK_BYTES, (index + 1) * AUTH_CHUNK_BYTES)
              .toString('base64'),
            aad(index, total),
          ),
        );

        await this.gateway.store.transaction(record.profileId, async (tx) => {
          const current = await this.owned(tx, record);
          await tx.put('channelAuth', record.id, record.profileId, {
            id: record.id,
            profileId: record.profileId,
            chunks,
          });
          await tx.put('channelConnection', record.id, record.profileId, {
            ...current,
            sessionSavedAt: this.now(),
            updatedAt: this.now(),
          });
        });
      },
      clear: () =>
        this.gateway.store.transaction(record.profileId, async (tx) => {
          await this.owned(tx, record);
          await tx.put('channelAuth', record.id, record.profileId, {
            id: record.id,
            profileId: record.profileId,
            chunks: [],
          });
        }),
    };
  }

  private async enqueue(record: ConnectionRecord, message: IncomingMessage) {
    await this.gateway.store.transaction(record.profileId, async (tx) => {
      await this.owned(tx, record);
      const channel = assertFound(await tx.get('channel', record.id), 'Channel');

      if (
        !channel.actorIds.includes(message.actorId) ||
        !channel.chatIds.includes(message.chatId)
      ) {
        return;
      }

      const id = createHash('sha256')
        .update(JSON.stringify([record.id, message.requestKey]))
        .digest('hex');

      if (await tx.get('channelInbox', id)) {
        return;
      }

      const pending = await tx.list('channelInbox', {
        profileId: record.profileId,
        where: { channelId: record.id, status: 'pending' },
        limit: 1000,
      });

      if (pending.length >= 1000) {
        throw new Error('WhatsApp inbox capacity reached');
      }

      await tx.put('channelInbox', id, record.profileId, {
        id,
        profileId: record.profileId,
        channelId: record.id,
        generation: record.generation,
        message,
        status: 'pending',
        receivedAt: this.now(),
      });
    });
  }

  private async open(record: ConnectionRecord) {
    const device = await this.factory(record.id, this.sessionStore(record), {
      qr: (value) =>
        this.update(record, {
          status: 'qr',
          qr: this.box.encrypt(value, `elos:whatsapp:qr:${record.profileId}:${record.id}`),
          qrExpiresAt: this.clock() + QR_LIFETIME_MS,
        }),
      ready: async (accountId) => {
        await this.gateway.store.transaction(record.profileId, async (tx) => {
          const current = await this.owned(tx, record);

          // A different phone requires an explicit disconnect, which invalidates queued replies.
          if (current.accountId && current.accountId !== accountId) {
            throw new GatewayError(409, 'Disconnect before linking a different WhatsApp account');
          }

          await tx.put('channelConnection', record.id, record.profileId, {
            ...current,
            status: 'connected',
            accountId,
            qr: undefined,
            qrExpiresAt: undefined,
            error: undefined,
            updatedAt: this.now(),
          });
        });
      },
      disconnected: async (loggedOut) => {
        if (loggedOut) {
          await this.sessionStore(record).clear();
        }

        await this.update(record, {
          desired: !loggedOut,
          retryAt: this.clock() + 5000,
          generation: loggedOut ? record.generation + 1 : record.generation,
          status: loggedOut ? 'disconnected' : 'connecting',
          owner: undefined,
          leaseUntil: 0,
          qr: undefined,
          qrExpiresAt: undefined,
          ...(loggedOut ? { sessionSavedAt: undefined, accountId: undefined } : {}),
        });
      },
      message: (message) => this.enqueue(record, message),
      failed: () =>
        this.update(record, {
          desired: false,
          status: 'error',
          qr: undefined,
          qrExpiresAt: undefined,
          error:
            'WhatsApp connection failed. Check Chromium and worker configuration, then reconnect.',
        }),
    });

    this.devices.set(record.id, {
      device,
      generation: record.generation,
      fence: record.fence ?? 0,
    });
    void device.start().catch(async () => {
      await this.update(record, {
        desired: false,
        status: 'error',
        qr: undefined,
        qrExpiresAt: undefined,
        error:
          'WhatsApp connection failed. Check Chromium and worker configuration, then reconnect.',
      }).catch(() => {});
    });
  }

  async tick(receive: Receiver) {
    const records = await this.gateway.store.list('channelConnection', { limit: 1000 });

    for (const record of records) {
      const channel = await this.gateway.store.get('channel', record.id);
      const local = this.devices.get(record.id);
      const lostOwnership = record.owner !== this.owner || (record.leaseUntil ?? 0) <= this.clock();

      if (
        local &&
        (!record.desired ||
          channel?.revokedAt ||
          record.generation !== local.generation ||
          record.fence !== local.fence ||
          lostOwnership)
      ) {
        this.devices.delete(record.id);
        await local.device
          .stop(!record.desired || !!channel?.revokedAt || record.generation !== local.generation)
          .catch(() => {});
      }

      if (
        this.stopped ||
        !record.desired ||
        !channel ||
        channel.revokedAt ||
        (record.retryAt ?? 0) > this.clock()
      ) {
        continue;
      }

      const claimed = await this.gateway.store.transaction(record.profileId, async (tx) => {
        const current = assertFound(await tx.get('channelConnection', record.id), 'Connection');

        if (
          !current.desired ||
          (current.owner !== this.owner && (current.leaseUntil ?? 0) > this.clock())
        ) {
          return null;
        }

        const active = this.devices.has(record.id);
        const next = {
          ...current,
          status: active ? current.status : ('connecting' as const),
          qr: active ? current.qr : undefined,
          qrExpiresAt: active ? current.qrExpiresAt : undefined,
          owner: this.owner,
          leaseUntil: this.clock() + LEASE_MS,
          fence: this.devices.has(record.id) ? current.fence : (current.fence ?? 0) + 1,
        };
        await tx.put('channelConnection', record.id, record.profileId, next);
        return next;
      });

      if (!claimed) {
        continue;
      }

      if (!this.devices.has(record.id)) {
        await this.open(claimed).catch(async () => {
          await this.update(claimed, {
            desired: false,
            status: 'error',
            error: 'Unable to start the WhatsApp device.',
          }).catch(() => {});
        });
      }

      const inbox = await this.gateway.store.list('channelInbox', {
        profileId: record.profileId,
        where: { channelId: record.id, status: 'pending' },
        limit: 20,
      });

      for (const item of inbox) {
        let status: 'submitted' | 'discarded' = 'submitted';

        try {
          await this.gateway.store.transaction(record.profileId, (tx) => this.owned(tx, claimed));

          if (item.generation !== claimed.generation) {
            status = 'discarded';
          } else {
            await receive(record.id, item.message, claimed.generation);
          }
        } catch (error) {
          // Session contention is transient; keep the message durable until its previous run finishes.
          if (error instanceof GatewayError && [400, 403, 404].includes(error.statusCode)) {
            status = 'discarded';
          } else {
            break;
          }
        }

        await this.gateway.store.transaction(record.profileId, async (tx) => {
          await this.owned(tx, claimed);
          await tx.put('channelInbox', item.id, record.profileId, {
            ...item,
            status,
            message: { ...item.message, text: '' },
          });
        });
      }
    }
  }

  async canSend(id: string, generation?: number) {
    const current = await this.gateway.store.get('channelConnection', id);
    const local = this.devices.get(id);

    return !!(
      current?.desired &&
      current.status === 'connected' &&
      (generation === undefined || current.generation === generation) &&
      current.owner === this.owner &&
      // Leave enough ownership time for the bounded network attempt.
      (current.leaseUntil ?? 0) > this.clock() + DEVICE_SEND_TIMEOUT_MS &&
      local?.generation === current.generation &&
      local.fence === current.fence
    );
  }

  async send(
    id: string,
    message: OutgoingMessage,
    signal: AbortSignal,
    generation?: number,
  ): Promise<DeliveryOutcome> {
    const remoteMessageIds: string[] = [];
    let attempted = false;

    try {
      const characters = Array.from(message.text);

      for (let offset = 0; offset < characters.length; offset += 4000) {
        signal.throwIfAborted();

        if (!(await this.canSend(id, generation))) {
          return { status: attempted ? 'unknown' : 'failed', remoteMessageIds };
        }

        const local = assertFound(this.devices.get(id), 'Device');
        attempted = true;
        remoteMessageIds.push(
          await local.device.send(
            message.chatId,
            characters.slice(offset, offset + 4000).join(''),
            signal,
          ),
        );
      }

      return { status: 'sent', remoteMessageIds };
    } catch {
      // A timeout can follow a successful remote write. Never replay an uncertain message.
      return { status: attempted ? 'unknown' : 'failed', remoteMessageIds };
    }
  }

  start(receive: Receiver) {
    const poll = async () => {
      if (this.stopped) return;
      this.pending = this.tick(receive).catch(() => console.error('elos: WhatsApp worker failed'));
      await this.pending;

      if (!this.stopped) {
        this.timer = setTimeout(poll, 2000);
        this.timer.unref();
      }
    };

    void poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
    await Promise.allSettled([...this.devices.values()].map((local) => local.device.stop(false)));
    this.devices.clear();

    const records = await this.gateway.store.list('channelConnection', {
      where: { owner: this.owner },
      limit: 1000,
    });
    for (const record of records) {
      await this.gateway.store.transaction(record.profileId, async (tx) => {
        const current = await tx.get('channelConnection', record.id);
        if (current?.owner !== this.owner) return;

        await tx.put('channelConnection', record.id, record.profileId, {
          ...current,
          owner: undefined,
          leaseUntil: 0,
          qr: undefined,
          qrExpiresAt: undefined,
          status: current.desired ? 'connecting' : current.status,
        });
      });
    }
  }
}
