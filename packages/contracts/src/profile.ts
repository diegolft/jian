import { z } from 'zod';

const endpointSchema = z.url().refine((value) => {
  const url = new URL(value);

  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !value.includes('#')
  );
}, 'Use an HTTP(S) endpoint without embedded credentials or fragments');

export const modelSchema = z
  .strictObject({
    provider: z.enum(['openai', 'anthropic', 'google', 'openai-compatible']),
    modelId: z.string().trim().min(1).max(160),
    apiKeyEnv: z
      .string()
      .regex(/^ELOS_PROVIDER_[A-Z0-9_]+$/)
      .optional(),
    credentialId: z.uuid().optional(),
    baseURL: endpointSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.apiKeyEnv && value.credentialId) {
      ctx.addIssue({ code: 'custom', message: 'Configure at most one credential reference' });
    }

    if (value.provider === 'openai-compatible' && !value.baseURL) {
      ctx.addIssue({ code: 'custom', message: 'baseURL is required for compatible providers' });
    }

    if (value.baseURL && !/^https?:\/\//.test(value.baseURL)) {
      ctx.addIssue({ code: 'custom', message: 'baseURL must use HTTP(S)' });
    }
  });

export const skillSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(12_000),
});

export const mcpSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_]{1,30}$/),
  url: endpointSchema,
  credentialId: z.uuid().optional(),
  bearerTokenEnv: z
    .string()
    .regex(/^ELOS_MCP_[A-Z0-9_]+$/)
    .optional(),
  allowedTools: z
    .array(z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/))
    .min(1)
    .max(30),
});

export const identitySchema = z.strictObject({
  role: z.string().max(1000).default(''),
  tone: z.string().max(1000).default(''),
  goals: z.array(z.string().max(500)).max(10).default([]),
  boundaries: z.array(z.string().max(500)).max(10).default([]),
});

export const contextPolicySchema = z
  .strictObject({
    inputTokens: z.number().int().min(4096).max(128000).default(16000),
    outputTokens: z.number().int().min(256).max(16000).default(4096),
    memoryTokens: z.number().int().min(0).max(8000).default(1500),
    historyTokens: z.number().int().min(0).max(32000).default(6000),
    toolResultTokens: z.number().int().min(128).max(8000).default(1500),
    maxSteps: z.number().int().min(1).max(30).default(12),
    maxRunTokens: z.number().int().min(8192).max(1000000).default(100000),
  })
  .refine((policy) => policy.outputTokens < policy.inputTokens, {
    message: 'Output reservation must be smaller than the input budget',
    path: ['outputTokens'],
  });

export const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(8_000),
  model: modelSchema,
  identity: identitySchema.default(() => identitySchema.parse({})),
  contextPolicy: contextPolicySchema.default(() => contextPolicySchema.parse({})),
  skills: z.array(skillSchema).max(20).default([]),
  mcpServers: z.array(mcpSchema).max(10).default([]),
  allowSelfManagement: z.boolean().default(false),
});

export const profilePatchSchema = profileSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
  identity: identitySchema.optional(),
  contextPolicy: contextPolicySchema.optional(),
  skills: z.array(skillSchema).max(20).optional(),
  mcpServers: z.array(mcpSchema).max(10).optional(),
  allowSelfManagement: z.boolean().optional(),
});

export const sessionSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  channel: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .default('api'),
});

export const submitSchema = z.strictObject({
  text: z.string().trim().min(1).max(8_000),
  requestKey: z.string().min(1).max(120),
});

export const memorySchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9_-]{1,100}$/),
  content: z.string().trim().min(1).max(4_000),
  expectedVersion: z.number().int().nonnegative(),
});
