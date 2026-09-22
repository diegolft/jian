import { ingressSchema } from '@jian/contracts';
import { GatewayError } from '../../core/errors.js';
import type {
  Channel,
  ChannelConfiguration,
  DeliveryContext,
  OutgoingMessage,
} from '../channel.js';
import type { WhatsAppConnections } from './connections.js';

export class WhatsAppChannel implements Channel {
  readonly type = 'whatsapp';

  constructor(private readonly connections: WhatsAppConnections) {}

  validateConfiguration(configuration: ChannelConfiguration) {
    if (configuration.token) {
      throw new GatewayError(400, 'WhatsApp uses a linked device, not a bot token');
    }

    // Explicit JIDs prevent accidental group/broadcast access and ambiguity between phone and LID IDs.
    if (
      [...configuration.actorIds, ...configuration.chatIds].some(
        (id) => !/^\d+@(c\.us|lid)$/.test(id),
      )
    ) {
      throw new GatewayError(400, 'WhatsApp requires direct-chat JIDs ending in @c.us or @lid');
    }
  }

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
