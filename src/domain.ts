import { z } from 'zod';

export const modelSchema = z.strictObject({
  provider: z.enum(['openai', 'anthropic', 'google', 'openai-compatible']),
  modelId: z.string().trim().min(1).max(160),
  apiKeyEnv: z.string().regex(/^ELOS_PROVIDER_[A-Z0-9_]+$/),
  baseURL: z.url().optional(),
}).superRefine((value, ctx) => {
  if (value.provider === 'openai-compatible' && !value.baseURL) ctx.addIssue({ code: 'custom', message: 'baseURL is required for compatible providers' });
  if (value.baseURL && !/^https?:\/\//.test(value.baseURL)) ctx.addIssue({ code: 'custom', message: 'baseURL must use HTTP(S)' });
});
export const skillSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_-]{1,64}$/), description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(12_000),
});
export const mcpSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_]{1,30}$/),
  url: z.url().refine(v => /^https?:\/\//.test(v), 'HTTP(S) URL required'),
  bearerTokenEnv: z.string().regex(/^ELOS_MCP_[A-Z0-9_]+$/).optional(),
  allowedTools: z.array(z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/)).min(1).max(30),
});
export const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(8_000),
  model: modelSchema,
  skills: z.array(skillSchema).max(20).default([]),
  mcpServers: z.array(mcpSchema).max(10).default([]),
  allowSelfManagement: z.boolean().default(false),
});
export const profilePatchSchema = profileSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
  skills: z.array(skillSchema).max(20).optional(),
  mcpServers: z.array(mcpSchema).max(10).optional(),
  allowSelfManagement: z.boolean().optional(),
});
export const sessionSchema = z.strictObject({
  title: z.string().trim().min(1).max(160), channel: z.string().regex(/^[a-z0-9_-]{1,40}$/).default('api'),
});
export const submitSchema = z.strictObject({ text: z.string().trim().min(1).max(8_000), requestKey: z.string().min(1).max(120) });
export const memorySchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9_-]{1,100}$/), content: z.string().trim().min(1).max(4_000),
  expectedVersion: z.number().int().nonnegative(),
});
export type ModelConfig = z.infer<typeof modelSchema>;
export type Profile = z.infer<typeof profileSchema> & { id: string; version: number; createdAt: string; updatedAt: string };
export type Session = z.infer<typeof sessionSchema> & { id: string; profileId: string; createdAt: string };
export type Message = { id: string; profileId: string; sessionId: string; runId: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type Memory = { id: string; profileId: string; key: string; content: string; version: number; sourceSessionId?: string; updatedAt: string };
export type Run = {
  id: string; profileId: string; sessionId: string; requestKey: string; input: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  profile: Profile; createdAt: string; updatedAt: string; leaseOwner?: string; leaseUntil?: number;
  error?: string; output?: string;
};
export type ProfileRevision = { id: string; profileId: string; profile: Profile; createdAt: string };
export type Records = { profile: Profile; revision: ProfileRevision; session: Session; message: Message; memory: Memory; run: Run };
export type Kind = keyof Records;
export type GatewayEvent = { id: number; profileId: string; runId?: string; type: string; data: unknown; createdAt: string };
export class GatewayError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export function assertFound<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new GatewayError(404, `${label} not found`);
  return value;
}
