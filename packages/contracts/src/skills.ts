import { z } from 'zod';

/**
 * Where an imported skill came from. Provenance only: the instructions are copied at import
 * time and never refreshed on their own, so a repository that changes later cannot rewrite
 * what an agent has already been told.
 */
export const skillOriginSchema = z.strictObject({
  url: z.url().max(600),
  ref: z.string().max(100).optional(),
  marketplace: z.string().max(100).optional(),
  plugin: z.string().max(100).optional(),
  importedAt: z.iso.datetime(),
});

export const skillImportSchema = z.strictObject({
  url: z.url().max(600),
});

export const catalogQuerySchema = z.strictObject({
  url: z.string().max(600),
});

export const catalogEntrySchema = z.strictObject({
  name: z.string().max(100),
  description: z.string().max(600),
  url: z.url().max(600),
  plugin: z.string().max(100).optional(),
});

/** A catalog is whatever a repository announces: a marketplace manifest, or a single skill. */
export const catalogSchema = z.strictObject({
  marketplace: z.string().max(100).optional(),
  entries: z.array(catalogEntrySchema).max(200),
});

export type SkillOrigin = z.infer<typeof skillOriginSchema>;
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
