import { z } from 'zod';

export const channelInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['generic', 'telegram', 'whatsapp']),
  sessionId: z.uuid(),
  actorIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  chatIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  credentialId: z.uuid().optional(),
});

export const channelSchema = channelInputSchema.extend({
  id: z.uuid(),
  profileId: z.uuid(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().optional(),
});

export const ingressSchema = z.strictObject({
  actorId: z.string().min(1).max(100),
  chatId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(8000),
  requestKey: z.string().min(1).max(120),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      from: z.object({ id: z.number().int() }),
      chat: z.object({ id: z.number().int() }),
      text: z.string().min(1).max(8000),
    })
    .optional(),
});

export const ingressResultSchema = z.strictObject({
  accepted: z.boolean(),
  runId: z.uuid().optional(),
});

export const deliverySchema = z.strictObject({
  id: z.uuid(),
  profileId: z.uuid(),
  channelId: z.uuid(),
  runId: z.uuid(),
  chatId: z.string(),
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'unknown']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  remoteMessageIds: z.array(z.union([z.number(), z.string()])).default([]),
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
