import { z } from 'zod';
import { profileSchema, sessionSchema } from './profile.js';

const uuid = z.uuid();
const timestamp = z.iso.datetime();

export const profileRecordSchema = profileSchema.extend({
  id: uuid,
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const sessionRecordSchema = sessionSchema.extend({
  id: uuid,
  profileId: uuid,
  createdAt: timestamp,
});

export const messageRecordSchema = z.strictObject({
  id: uuid,
  profileId: uuid,
  sessionId: uuid,
  runId: uuid,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: timestamp,
});

export const memoryRecordSchema = z.strictObject({
  id: z.string(),
  profileId: uuid,
  key: z.string(),
  content: z.string(),
  version: z.number().int().positive(),
  sourceSessionId: uuid.optional(),
  updatedAt: timestamp,
});

export const usageSchema = z.strictObject({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  steps: z.number().int().nonnegative(),
});

export const runRecordSchema = z.strictObject({
  id: uuid,
  profileId: uuid,
  sessionId: uuid,
  requestKey: z.string(),
  input: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled']),
  createdAt: timestamp,
  updatedAt: timestamp,
  error: z.string().optional(),
  output: z.string().optional(),
  usage: usageSchema.optional(),
  continuationOf: uuid.optional(),
});

export const revisionRecordSchema = z.strictObject({
  id: z.string(),
  profileId: uuid,
  profile: profileRecordSchema,
  createdAt: timestamp,
});

export const eventSchema = z.strictObject({
  id: z.number().int(),
  profileId: uuid,
  runId: uuid.optional(),
  type: z.string(),
  data: z.unknown(),
  createdAt: timestamp,
});

export type ModelConfig = z.infer<typeof profileSchema>['model'];

export type Profile = z.infer<typeof profileRecordSchema>;

export type Session = z.infer<typeof sessionRecordSchema>;

export type Message = z.infer<typeof messageRecordSchema>;

export type Memory = z.infer<typeof memoryRecordSchema>;

export type Run = z.infer<typeof runRecordSchema> & {
  profile: Profile;
  leaseOwner?: string;
  leaseUntil?: number;
};

export type ProfileRevision = z.infer<typeof revisionRecordSchema>;

export type GatewayEvent = z.infer<typeof eventSchema>;

export const checkpointSchema = z.strictObject({
  id: z.uuid(),
  profileId: z.uuid(),
  runId: z.uuid(),
  data: z.unknown(),
  createdAt: z.iso.datetime(),
});

export type Checkpoint = z.infer<typeof checkpointSchema>;

export const continuationSchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  requestKey: z.string().min(1).max(120),
  reconciliation: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      'Describe which external effects completed or were verified absent before continuing.',
    ),
});
