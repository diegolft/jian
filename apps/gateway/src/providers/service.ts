import { randomUUID } from 'node:crypto';
import {
  type ModelConfig,
  type ModelSelection,
  modelDefaultsInputSchema,
  modelDefaultsRecordSchema,
  type ProviderRecord,
  providerInputSchema,
  providerRecordSchema,
  type Run,
} from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Reader, Store } from '../core/store.js';
import type { ProfileReader } from '../profiles/port.js';
import type { Vault } from '../security/vault.js';
import { modelCapabilities } from './capabilities.js';
import { environmentProvider, providerKinds } from './catalog.js';

/** Where a provider's key lives in the vault. Revoking the provider takes the key with it. */
export const providerSecret = (providerId: string) => `provider:${providerId}`;

/** The ceilings a run freezes; the run record keeps them optional for pre-selection runs. */
export type ContextPolicy = NonNullable<Run['contextPolicy']>;

/**
 * Providers registered before model discovery stored a hand-written model list, and before the
 * vault moved indoors they pointed at a credential by id. The record declares neither now and
 * the strict schema would reject both, so they are dropped on read. The key itself lives in the
 * vault under the provider's own id; a provider configured before that move has none and has to
 * be configured again.
 */
function current(record: ProviderRecord): ProviderRecord {
  const {
    models: _models,
    credentialId: _credential,
    ...rest
  } = record as ProviderRecord & { models?: unknown; credentialId?: unknown };

  return rest;
}

export class Providers {
  constructor(
    private readonly store: Store,
    private readonly profiles: ProfileReader,
    private readonly vault: Vault,
    private readonly clock: Clock = Date.now,
  ) {}

  async providers(profileId: string) {
    await this.profiles.profile(profileId);

    const stored = (await this.store.list('provider', { profileId, limit: 100 })).map((item) =>
      providerRecordSchema.parse(current(item)),
    );
    // A configured provider hides the host environment's key for the same vendor.
    const environment = providerKinds
      .map((kind) => environmentProvider(profileId, kind))
      .filter((provider) => provider !== null)
      .filter((provider) => !stored.some((item) => !item.revokedAt && item.kind === provider.kind));

    return [...stored, ...environment];
  }

  async createProvider(profileId: string, input: unknown) {
    const { secret, ...data } = providerInputSchema.parse(input);

    return this.register(
      profileId,
      { ...data, id: randomUUID(), profileId, createdAt: nowIso(this.clock) },
      secret,
    );
  }

  configureCodexProvider(profileId: string, secret: string) {
    return this.register(
      profileId,
      providerRecordSchema.parse({
        id: randomUUID(),
        profileId,
        name: 'OpenAI',
        kind: 'openai',
        authMode: 'codex',
        createdAt: nowIso(this.clock),
      }),
      secret,
    );
  }

  /** One live provider per vendor: configuring another revokes the old one and its key. */
  private async register(profileId: string, provider: ProviderRecord, secret: string) {
    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      for (const item of await tx.list('provider', { profileId, limit: 100 })) {
        if (item.kind === provider.kind && !item.revokedAt) {
          await tx.put('provider', item.id, profileId, { ...item, revokedAt: nowIso(this.clock) });
          await this.vault.discard(profileId, providerSecret(item.id), tx);
        }
      }

      await this.vault.put(profileId, providerSecret(provider.id), secret, tx);
      await tx.put('provider', provider.id, profileId, provider);

      await recordEvent(tx, this.clock, profileId, 'provider.created', {
        id: provider.id,
        kind: provider.kind,
      });

      return provider;
    });
  }

  async revokeProvider(profileId: string, providerId: string) {
    return this.store.transaction(profileId, async (tx) => {
      const provider = await tx.get('provider', providerId);

      if (!provider || provider.profileId !== profileId) {
        throw new GatewayError(404, 'Provider not found');
      }

      const revoked = { ...provider, revokedAt: provider.revokedAt ?? nowIso(this.clock) };

      await tx.put('provider', providerId, profileId, revoked);
      await this.vault.discard(profileId, providerSecret(providerId), tx);
      await recordEvent(tx, this.clock, profileId, 'provider.revoked', { id: providerId });

      return revoked;
    });
  }

  async modelDefaults(profileId: string) {
    await this.profiles.profile(profileId);
    const defaults = await this.store.get('modelDefault', profileId);

    // Parsed on the way out so a record written before a role existed reads back as empty
    // for that role instead of leaving the field missing from the response.
    return modelDefaultsRecordSchema.parse({
      ...defaults,
      id: profileId,
      profileId,
      updatedAt: defaults?.updatedAt ?? nowIso(this.clock),
    });
  }

  async setModelDefaults(profileId: string, input: unknown) {
    const data = modelDefaultsInputSchema.parse(input);

    return this.store.transaction(profileId, async (tx) => {
      await this.profiles.profile(profileId, tx);

      // Every role is validated, including the ones no runtime executes yet: a selection that
      // cannot resolve today would fail silently the day its runtime lands.
      for (const selection of Object.values(data)) {
        if (selection) {
          await this.selectedModel(profileId, selection, tx);
        }
      }

      const defaults = modelDefaultsRecordSchema.parse({
        ...data,
        id: profileId,
        profileId,
        updatedAt: nowIso(this.clock),
      });

      await tx.put('modelDefault', profileId, profileId, defaults);
      await recordEvent(tx, this.clock, profileId, 'model-defaults.updated', data);

      return defaults;
    });
  }

  async selectedModel(
    profileId: string,
    selection: ModelSelection,
    reader: Reader,
  ): Promise<{ config: ModelConfig; policy: ContextPolicy }> {
    const provider =
      (await reader.get('provider', selection.providerId)) ??
      providerKinds
        .map((kind) => environmentProvider(profileId, kind))
        .find((item) => item?.id === selection.providerId);

    if (!provider || provider.profileId !== profileId || provider.revokedAt) {
      throw new GatewayError(409, 'Selected provider or model is unavailable');
    }

    // Which models exist is the provider's answer and can change between two requests, so a
    // selection is never checked against a list: a provider outage would otherwise revoke a
    // model the owner already chose. Only the provider itself has to be live.
    const model = modelCapabilities(provider.kind, selection.modelId);

    if (selection.reasoningEffort && !model.reasoningEfforts.includes(selection.reasoningEffort)) {
      throw new GatewayError(
        409,
        model.known
          ? 'This model does not accept the selected reasoning effort'
          : 'Reasoning effort is not catalogued for this model',
      );
    }

    // Ceilings, not targets: a large context window must not inflate routine memory/history.
    return {
      config: {
        provider: provider.authMode === 'codex' ? ('openai-codex' as const) : provider.kind,
        modelId: selection.modelId,
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : { providerId: provider.id }),
      },
      policy: {
        inputTokens: Math.min(32_000, Math.max(4096, Math.floor(model.contextWindow * 0.45))),
        outputTokens: Math.min(4096, model.maxOutputTokens, Math.floor(model.contextWindow * 0.12)),
        memoryTokens: Math.min(1500, Math.floor(model.contextWindow * 0.04)),
        historyTokens: Math.min(6000, Math.floor(model.contextWindow * 0.12)),
        toolResultTokens: Math.min(1500, Math.max(128, Math.floor(model.contextWindow * 0.04))),
        maxSteps: 12,
        maxRunTokens: 100_000,
      },
    };
  }
}
