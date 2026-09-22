import type { ModelSelection, ProviderRecord } from '@jian/contracts';
import { bareModelId } from './capabilities.js';
import type { ModelCatalog } from './catalog-source.js';
import type { ProviderModels } from './discovery.js';
import type { ProviderAdmin } from './port.js';

/**
 * Picks a model when the owner has not, so a profile answers as soon as a provider exists.
 *
 * Nothing is chosen by name. A vendor's listing mixes chat models with embeddings, speech and
 * image ones, and "the first" of that list is usually an embedding model — so the choice is
 * made from what the public catalog says each model takes in and gives back, and the newest
 * text model wins. A model the catalog does not know is skipped rather than guessed at: the
 * owner picking one themselves is better than an agent that answers with an image endpoint.
 */
export class ModelFallback {
  constructor(
    private readonly providers: ProviderAdmin,
    private readonly models: Pick<ProviderModels, 'list'>,
    private readonly catalog?: ModelCatalog,
  ) {}

  async pick(): Promise<ModelSelection | null> {
    // The catalog is what tells a chat model from an embedding one, and on a gateway that has
    // just started it has not been read yet. Waiting for it here is the difference between a
    // first message that answers and one that asks the owner to go and configure something.
    await this.catalog?.prime().catch(() => undefined);

    const live = (await this.providers.providers()).filter((provider) => !provider.revokedAt);

    for (const provider of live) {
      const chosen = await this.fromProvider(provider);

      if (chosen) {
        return chosen;
      }
    }

    return null;
  }

  private async fromProvider(provider: ProviderRecord): Promise<ModelSelection | null> {
    const listed = await this.models.list(provider.id).catch(() => null);

    if (!listed || listed.models.length === 0) {
      return null;
    }

    const conversational = listed.models.flatMap((model) => {
      const entry = this.catalog?.lookup(provider.kind, bareModelId(model.id));

      // Both directions have to be text. A model that only returns audio or images answers a
      // chat with something no channel can deliver.
      if (!entry?.inputModalities.includes('text') || !entry.outputModalities.includes('text')) {
        return [];
      }

      return [{ id: model.id, entry }];
    });

    const best = conversational.sort(
      (a, b) =>
        (b.entry.releaseDate ?? '').localeCompare(a.entry.releaseDate ?? '') ||
        (b.entry.contextWindow ?? 0) - (a.entry.contextWindow ?? 0) ||
        a.id.localeCompare(b.id),
    )[0];

    return best ? { providerId: provider.id, modelId: best.id } : null;
  }
}
