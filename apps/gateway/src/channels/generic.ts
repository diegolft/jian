import { ingressSchema } from '@jian/contracts';
import type { Channel, IncomingMessage } from './channel.js';

/** The caller authenticates external users before forwarding their IDs to this webhook. */
export class GenericChannel implements Channel {
  readonly type = 'generic';
  readonly webhookHeader = 'x-jian-channel-token';

  receive(payload: unknown): IncomingMessage {
    return ingressSchema.parse(payload);
  }
}
