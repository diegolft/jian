import type { channelTypeSchema, ingressSchema } from '@jian/contracts';
import type { z } from 'zod';

export type ChannelType = z.infer<typeof channelTypeSchema>;

export type IncomingMessage = z.infer<typeof ingressSchema>;

export interface ChannelRequest {
  type: ChannelType;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  payload: unknown;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
}

export interface DeliveryContext {
  channelId: string;
  connectionGeneration?: number;
  credential?: string;
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

export interface DeliveryOutcome {
  status: 'sent' | 'failed' | 'unknown';
  remoteMessageIds: Array<string | number>;
}

/** Protocol adapters never choose the profile, session or permissions of an incoming message. */
export interface Channel {
  readonly type: ChannelType;
  readonly webhookHeader?: string;

  receive(payload: unknown): IncomingMessage | null;

  /**
   * What this connection speaks as on its protocol, asked once when the channel is connected.
   * A protocol that cannot answer leaves the connection unidentified, and the messages of the
   * installation's other agents are then read as anyone else's.
   */
  identify?(
    credential: string,
    fetch: typeof globalThis.fetch,
    signal: AbortSignal,
  ): Promise<string | undefined>;

  canSend?(channelId: string): Promise<boolean>;
  // An absent sender describes an ingress-only channel; it is not a fake successful delivery.
  send?(message: OutgoingMessage, context: DeliveryContext): Promise<DeliveryOutcome>;
}
