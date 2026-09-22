import { z } from 'zod';
import { modelSelectionSchema, reasoningEffortSchema } from './providers.js';
import { secretSchema } from './security.js';
import { skillOriginSchema } from './skills.js';

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
    provider: z.enum([
      'openai',
      'anthropic',
      'google',
      'openrouter',
      'openai-compatible',
      'openai-codex',
    ]),
    modelId: z.string().trim().min(1).max(160),
    apiKeyEnv: z
      .string()
      .regex(
        /^(?:JIAN_PROVIDER_[A-Z0-9_]+|ANTHROPIC_API_KEY|ANTHROPIC_API_TOKEN|GEMINI_API_TOKEN|OPENAI_API_KEY)$/,
      )
      .optional(),
    providerId: z.uuid().optional(),
    baseURL: endpointSchema.optional(),
    // Frozen with the run: the effort chosen next to the model is what the request carries.
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.apiKeyEnv && value.providerId) {
      ctx.addIssue({ code: 'custom', message: 'Configure at most one provider reference' });
    }

    if (value.provider === 'openai-compatible' && !value.baseURL) {
      ctx.addIssue({ code: 'custom', message: 'baseURL is required for compatible providers' });
    }

    if (value.baseURL && !/^https?:\/\//.test(value.baseURL)) {
      ctx.addIssue({ code: 'custom', message: 'baseURL must use HTTP(S)' });
    }
  });

export const skillNameSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/);

export const skillSchema = z.strictObject({
  name: skillNameSchema,
  description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(12_000),
  // Present only on a skill the owner imported. A self-managing agent writes its own skills
  // and never this field, which is what keeps "who wrote this instruction" answerable.
  origin: skillOriginSchema.optional(),
});

/**
 * A skill shipped with the gateway. The owner cannot edit or remove one — only switch it off
 * for a profile — so the instructions travel with it: what an agent is told has to be readable.
 */
export const builtinSkillSchema = skillSchema.extend({
  enabled: z.boolean(),
});

export const mcpSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_]{1,30}$/),
  url: endpointSchema,
  // Sent to replace the stored token; absent keeps whatever the vault already holds.
  bearerToken: secretSchema.optional(),
  bearerTokenEnv: z
    .string()
    .regex(/^JIAN_MCP_[A-Z0-9_]+$/)
    .optional(),
});

/** What a server answered when the owner asked whether it works. */
export const mcpStatusSchema = z.strictObject({
  name: z.string(),
  reachable: z.boolean(),
  /** Everything the server offers. The agent still loads a tool before it can call it. */
  tools: z
    .array(z.strictObject({ name: z.string(), description: z.string().max(600).optional() }))
    .max(500)
    .default([]),
  error: z.string().max(300).optional(),
  checkedAt: z.iso.datetime(),
});

export const identitySchema = z.strictObject({
  role: z.string().max(1000).default(''),
  tone: z.string().max(1000).default(''),
  goals: z.array(z.string().max(500)).max(10).default([]),
  boundaries: z.array(z.string().max(500)).max(10).default([]),
});

export const contextPolicySchema = z
  .strictObject({
    // The tool definitions the runtime sends cost roughly 9000 tokens before anything the
    // owner wrote. A budget below that refuses every run, which is why the floor is generous.
    inputTokens: z.number().int().min(16000).max(128000).default(32000),
    outputTokens: z.number().int().min(256).max(16000).default(4096),
    memoryTokens: z.number().int().min(0).max(8000).default(1500),
    historyTokens: z.number().int().min(0).max(32000).default(6000),
    toolResultTokens: z.number().int().min(128).max(8000).default(1500),
    maxSteps: z.number().int().min(1).max(30).default(12),
    // One model call already costs the tool definitions; a cap under two calls' worth ends
    // the run before it starts.
    maxRunTokens: z.number().int().min(32000).max(1000000).default(100000),
  })
  .refine((policy) => policy.outputTokens < policy.inputTokens, {
    message: 'Output reservation must be smaller than the input budget',
    path: ['outputTokens'],
  });

/**
 * The profile picture travels inline so every client renders it from the profile it already
 * fetched. It stays out of `identity` because identity is serialized into the system prompt
 * and is writable by a self-managing agent; base64 belongs in neither. The cap keeps a
 * profile write inside the 256 KB request body limit — roughly a 256x256 JPEG.
 */
export const avatarSchema = z
  .string()
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    'Use an inline PNG, JPEG or WebP image',
  )
  .max(100_000, 'The picture must stay under 100 kB encoded');

/**
 * The one line the other agents of this installation read about this one. Discovery shows the
 * name and this text, and nothing else ever crosses: instructions, identity, memories and
 * history stay inside the profile. Empty until the owner writes it.
 */
export const summarySchema = z.string().trim().max(280).default('');

export const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(8_000),
  summary: summarySchema,
  avatar: avatarSchema.nullable().default(null),
  // Retained for existing installations and old runs; new profiles choose models per run.
  model: modelSchema.default({ provider: 'openai', modelId: 'unconfigured' }),
  identity: identitySchema.default(() => identitySchema.parse({})),
  contextPolicy: contextPolicySchema.default(() => contextPolicySchema.parse({})),
  skills: z.array(skillSchema).max(20).default([]),
  // Built-in skills this profile should not carry. Imported skills are removed from `skills`;
  // a built-in one cannot be removed, only switched off here.
  disabledSkills: z.array(skillNameSchema).max(20).default([]),
  mcpServers: z.array(mcpSchema).max(10).default([]),
  allowSelfManagement: z.boolean().default(false),
  /**
   * Reading files, writing files and running commands on the machine the gateway runs on,
   * with the privileges of whoever started it. Off by default and never implied by anything
   * else: it is the one setting that turns a conversation into access to a computer.
   */
  allowShell: z.boolean().default(false),
});

export const profilePatchSchema = profileSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
  summary: summarySchema.optional(),
  // Absent keeps the current picture; an explicit null removes it.
  avatar: avatarSchema.nullable().optional(),
  model: modelSchema.optional(),
  identity: identitySchema.optional(),
  contextPolicy: contextPolicySchema.optional(),
  skills: z.array(skillSchema).max(20).optional(),
  disabledSkills: z.array(skillNameSchema).max(20).optional(),
  mcpServers: z.array(mcpSchema).max(10).optional(),
  allowSelfManagement: z.boolean().optional(),
  allowShell: z.boolean().optional(),
});

export const sessionSchema = z.strictObject({
  // Absent on purpose: the agent names the conversation from its first message, and the owner
  // renames it whenever they like. Asking for a name before there is anything to name is not
  // a decision anyone can make well.
  title: z.string().trim().min(1).max(160).optional(),
  channel: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .default('api'),
});

export const sessionRenameSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
});

export const submitSchema = z.strictObject({
  text: z.string().trim().min(1).max(8_000),
  requestKey: z.string().min(1).max(120),
  model: modelSelectionSchema.optional(),
});

export const memoryKeySchema = z.string().regex(/^[a-z0-9_-]{1,100}$/);

export const memorySchema = z.strictObject({
  key: memoryKeySchema,
  content: z.string().trim().min(1).max(4_000),
  expectedVersion: z.number().int().nonnegative(),
});

export type McpStatus = z.infer<typeof mcpStatusSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type McpServer = z.infer<typeof mcpSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type ContextPolicy = z.infer<typeof contextPolicySchema>;
