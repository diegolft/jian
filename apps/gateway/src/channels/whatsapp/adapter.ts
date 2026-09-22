import { ingressSchema } from '@jian/contracts';
import type { Channel, DeliveryContext, OutgoingMessage } from '../channel.js';
import type { WhatsAppConnections } from './connections.js';

export class WhatsAppChannel implements Channel {
  readonly type = 'whatsapp';

  constructor(private readonly connections: WhatsAppConnections) {}

  receive(payload: unknown) {
    return ingressSchema.parse(payload);
  }

  canSend(channelId: string) {
    return this.connections.canSend(channelId);
  }

  send(message: OutgoingMessage, context: DeliveryContext) {
    return this.connections.send(
      context.channelId,
      message,
      context.signal,
      context.connectionGeneration,
    );
  }
}
