import { telegramUpdateSchema } from '@jian/contracts';
import type {
  Channel,
  DeliveryContext,
  DeliveryOutcome,
  IncomingMessage,
  OutgoingMessage,
} from './channel.js';

const MESSAGE_CHUNK_SIZE = 4000;
const REQUEST_TIMEOUT_MS = 15_000;

export class TelegramChannel implements Channel {
  readonly type = 'telegram';
  readonly webhookHeader = 'x-telegram-bot-api-secret-token';

  receive(payload: unknown): IncomingMessage | null {
    const update = telegramUpdateSchema.parse(payload);

    if (!update.message) {
      return null;
    }

    const name = update.message.from.first_name ?? update.message.from.username;

    return {
      actorId: String(update.message.from.id),
      chatId: String(update.message.chat.id),
      text: update.message.text,
      requestKey: String(update.update_id),
      ...(name ? { displayName: name } : {}),
    };
  }

  async send(message: OutgoingMessage, context: DeliveryContext): Promise<DeliveryOutcome> {
    const token = context.credential;
    const remoteMessageIds: number[] = [];

    if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      return { status: 'failed', remoteMessageIds };
    }

    try {
      for (let offset = 0; offset < message.text.length; offset += MESSAGE_CHUNK_SIZE) {
        const response = await context.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          body: JSON.stringify({
            chat_id: message.chatId,
            text: message.text.slice(offset, offset + MESSAGE_CHUNK_SIZE),
          }),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          result?: { message_id?: number };
        };

        if (!response.ok || !result.ok || typeof result.result?.message_id !== 'number') {
          return { status: 'unknown', remoteMessageIds };
        }

        remoteMessageIds.push(result.result.message_id);
      }

      return { status: 'sent', remoteMessageIds };
    } catch {
      // A lost response does not prove the message was absent. Preserve confirmed chunks and stop.
      // Never log the request URL: Telegram places the bot credential in its path.
      return { status: 'unknown', remoteMessageIds };
    }
  }
}
