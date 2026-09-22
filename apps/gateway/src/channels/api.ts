import { ingressSchema } from '@jian/contracts';
import type { Channel, IncomingMessage } from './channel.js';

/** The caller authenticates external users before forwarding their IDs to this webhook. */
export class ApiChannel implements Channel {
  readonly type = 'api';
  readonly webhookHeader = 'x-jian-channel-token';
  // Whatever consumes this endpoint renders the answer itself, so it gets it as written.
  readonly rendersMarkdown = true;

  receive(payload: unknown): IncomingMessage {
    return ingressSchema.parse(payload);
  }
}
