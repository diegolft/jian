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

/** Telegram calls a room a group until it is upgraded; both carry the same message shape. */
const GROUP_CHATS = new Set(['group', 'supergroup']);

const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]+$/;

export class TelegramChannel implements Channel {
  readonly type = 'telegram';
  readonly webhookHeader = 'x-telegram-bot-api-secret-token';

  receive(payload: unknown): IncomingMessage | null {
    const update = telegramUpdateSchema.parse(payload);

    if (!update.message) {
      return null;
    }

    const message = update.message;
    const name = message.from.first_name ?? message.from.username;
    const group = GROUP_CHATS.has(message.chat.type ?? '');

    return {
      actorId: String(message.from.id),
      chatId: String(message.chat.id),
      text: message.text,
      requestKey: String(update.update_id),
      ...(name ? { displayName: name } : {}),
      scope: group ? 'group' : 'direct',
      ...(group && message.chat.title ? { groupName: message.chat.title } : {}),
      // Only a mention that names an account carries its id; an @username entity does not.
      mentions: (message.entities ?? []).flatMap((entity) =>
        entity.user ? [String(entity.user.id)] : [],
      ),
    };
  }

  /** The bot's own numeric id, which is how its messages are recognised in a group. */
  async identify(
    credential: string,
    fetch: typeof globalThis.fetch,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (!BOT_TOKEN.test(credential)) {
      return undefined;
    }

    // Never log the request URL: Telegram places the bot credential in its path.
    const response = await fetch(`https://api.telegram.org/bot${credential}/getMe`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });

    const result = (await response.json()) as { ok?: boolean; result?: { id?: number } };

    return response.ok && result.ok && typeof result.result?.id === 'number'
      ? String(result.result.id)
      : undefined;
  }

  async send(message: OutgoingMessage, context: DeliveryContext): Promise<DeliveryOutcome> {
    const token = context.credential;
    const remoteMessageIds: number[] = [];

    if (!token || !BOT_TOKEN.test(token)) {
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
