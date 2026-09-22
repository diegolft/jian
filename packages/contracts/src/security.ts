import { z } from 'zod';

export const scopeSchema = z.enum(['read', 'chat', 'memory:write', 'profile:write']);

export type Scope = z.infer<typeof scopeSchema>;

export const credentialInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  kind: z.enum(['provider', 'mcp', 'channel']),
  secret: z.string().min(1).max(16000).meta({ writeOnly: true }),
});

export const credentialMetadataSchema = credentialInputSchema.omit({ secret: true }).extend({
  id: z.uuid(),
  profileId: z.uuid(),
  version: z.number().int(),
  keyId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().optional(),
});

export const keyInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  scopes: z.array(scopeSchema).min(1).max(4),
  expiresAt: z.iso.datetime(),
});

export const keyMetadataSchema = keyInputSchema.extend({
  id: z.uuid(),
  profileId: z.uuid(),
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().optional(),
});
