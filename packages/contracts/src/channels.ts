import { z } from 'zod';
import { secretSchema } from './security.js';

/** One channel of each type per profile: the panel connects a type, it does not name a binding. */
export const channelTypeSchema = z.enum(['whatsapp', 'telegram', 'api']);

export const channelInputSchema = z
  .strictObject({
    type: channelTypeSchema,
    // The Telegram bot token. It goes to the vault under `channel:<id>` and is never read back.
    botToken: secretSchema.optional(),
  })
  .refine((value) => (value.type === 'telegram') === (value.botToken !== undefined), {
    message: 'Telegram connects with a bot token; the other channels connect without one',
    path: ['botToken'],
  });

export const channelSchema = z.strictObject({
  id: z.uuid(),
  profileId: z.uuid(),
  type: channelTypeSchema,
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().optional(),
});

/** Approval is per sender, so a stranger cannot reach the agent by knowing the channel. */
export const contactSchema = z.strictObject({
  id: z.uuid(),
  profileId: z.uuid(),
  channelId: z.uuid(),
  type: channelTypeSchema,
  actorId: z.string().min(1).max(100),
  chatId: z.string().min(1).max(100),
  displayName: z.string().max(100).optional(),
  status: z.enum(['pending', 'approved', 'blocked']),
  sessionId: z.uuid().optional(),
  message: z.string().max(8000).optional().describe('The message held until the owner decides.'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const ingressSchema = z.strictObject({
  actorId: z.string().min(1).max(100),
  chatId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(8000),
  requestKey: z.string().min(1).max(120),
  displayName: z.string().trim().min(1).max(100).optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      from: z.object({
        id: z.number().int(),
        first_name: z.string().max(100).optional(),
        username: z.string().max(100).optional(),
      }),
      chat: z.object({ id: z.number().int() }),
      text: z.string().min(1).max(8000),
    })
    .optional(),
});

export const ingressResultSchema = z.strictObject({
  accepted: z.boolean(),
  runId: z.uuid().optional(),
  contact: z
    .enum(['approved', 'pending', 'blocked'])
    .optional()
    .describe('Absent when the payload carried no message to route.'),
});

export const deliverySchema = z.strictObject({
  id: z.uuid(),
  profileId: z.uuid(),
  channelId: z.uuid(),
  runId: z.uuid().optional(),
  chatId: z.string(),
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'unknown']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  remoteMessageIds: z.array(z.union([z.number(), z.string()])).default([]),
  notice: z
    .string()
    .max(1000)
    .optional()
    .describe('Gateway-authored text sent without a run, such as the approval notice.'),
});

/** Linking a device grants account access, so these endpoints are administrator-only. */
export const channelConnectionSchema = z.strictObject({
  channelId: z.uuid(),
  status: z.enum(['disconnected', 'connecting', 'qr', 'connected', 'error']),
  accountId: z.string().optional(),
  sessionSavedAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime(),
  error: z.string().optional(),
});

export const channelQrSchema = z.strictObject({
  qr: z.string().describe('Sensitive QR payload. Render locally and never log or cache it.'),
  expiresAt: z.iso.datetime(),
});
