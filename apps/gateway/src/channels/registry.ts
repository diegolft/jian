import { GatewayError } from '../domain.js';
import type { Channel, ChannelType } from './channel.js';
import { GenericChannel } from './generic.js';
import { TelegramChannel } from './telegram.js';

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelType, Channel>();

  constructor(channels: readonly Channel[] = [new GenericChannel(), new TelegramChannel()]) {
    for (const channel of channels) {
      if (this.adapters.has(channel.type)) {
        throw new Error(`Duplicate channel adapter: ${channel.type}`);
      }

      this.adapters.set(channel.type, channel);
    }
  }

  get(type: ChannelType): Channel {
    const channel = this.adapters.get(type);

    if (!channel) {
      throw new GatewayError(400, 'Channel type is not configured');
    }

    return channel;
  }
}
