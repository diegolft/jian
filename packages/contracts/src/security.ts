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

/**
 * The panel signs in once with the host token and then rides a signed, HttpOnly cookie, so the
 * token itself never reaches browser storage and no script can read the session back.
 */
export const panelSessionInputSchema = z.strictObject({
  token: z.string().min(32).max(512).meta({ writeOnly: true }),
});

export const panelSessionSchema = z.strictObject({
  expiresAt: z.iso.datetime(),
});

export const panelSessionEndSchema = z.strictObject({ ended: z.literal(true) });
