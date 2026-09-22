import { z } from 'zod';
import { secretSchema } from './security.js';

export const providerModelSchema = z.strictObject({
  id: z.string().trim().min(1).max(160),
  contextWindow: z.number().int().min(4096).max(1_000_000),
  maxOutputTokens: z.number().int().min(256).max(128_000),
});

/** The key travels once, on the way in. `createdAt` is the only thing said about it afterwards. */
export const providerInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['openai', 'anthropic', 'google']),
  secret: secretSchema,
  models: z.array(providerModelSchema).min(1).max(30),
});

export const providerRecordSchema = providerInputSchema.omit({ secret: true }).extend({
  apiKeyEnv: z.string().optional(),
  authMode: z.enum(['api', 'codex']).optional(),
  id: z.uuid(),
  profileId: z.uuid(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().optional(),
});

export const codexLoginSchema = z.strictObject({
  status: z.enum(['pending', 'connected', 'failed']),
  verificationUrl: z.url().optional(),
  userCode: z.string().optional(),
  error: z.string().optional(),
});

export const modelSelectionSchema = z.strictObject({
  providerId: z.uuid(),
  modelId: z.string().trim().min(1).max(160),
});

export const modelDefaultsInputSchema = z.strictObject({
  conversation: modelSelectionSchema.nullable(),
  channel: modelSelectionSchema.nullable(),
});

export const modelDefaultsRecordSchema = modelDefaultsInputSchema.extend({
  id: z.uuid(),
  profileId: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export type ProviderRecord = z.infer<typeof providerRecordSchema>;
export type ModelDefaultsRecord = z.infer<typeof modelDefaultsRecordSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
