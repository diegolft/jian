import type { ProviderModel, ProviderModelList, ProviderRecord } from '@jian/contracts';
import { z } from 'zod';
import { type Clock, nowIso } from '../core/clock.js';
import { GatewayError } from '../core/errors.js';
import type { Vault } from '../security/vault.js';
import { bareModelId, modelCapabilities } from './capabilities.js';
import type { ProviderKind } from './catalog.js';
import type { ProviderAdmin } from './port.js';
import { providerSecret } from './service.js';

/** Each provider's own list of what the authenticated account may call. */
const endpoints: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models?limit=1000',
  google: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
};

const listed = z.object({
  data: z
    .array(z.object({ id: z.string().min(1), display_name: z.string().optional() }))
    .optional(),
  models: z
    .array(
      z.object({
        name: z.string().min(1),
        displayName: z.string().optional(),
        inputTokenLimit: z.number().optional(),
        outputTokenLimit: z.number().optional(),
      }),
    )
    .optional(),
});

function parse(kind: ProviderKind, body: unknown): ProviderModel[] {
  const payload = listed.parse(body);
  const rows =
    kind === 'google'
      ? (payload.models ?? []).map((model) => ({
          id: bareModelId(model.name),
          displayName: model.displayName,
          reported: {
            contextWindow: model.inputTokenLimit,
            maxOutputTokens: model.outputTokenLimit,
          },
        }))
      : (payload.data ?? []).map((model) => ({
          id: model.id,
          displayName: model.display_name,
          reported: undefined,
        }));

  const unique = new Map<string, ProviderModel>();

  for (const row of rows) {
    if (!row.id || row.id.length > 160 || unique.has(row.id)) continue;

    unique.set(row.id, {
      id: row.id,
      ...(row.displayName ? { displayName: row.displayName.slice(0, 200) } : {}),
      ...modelCapabilities(kind, row.id, row.reported),
    });
  }

  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
}

type Entry = { list: ProviderModelList; expiresAt: number };

export interface ProviderModelOptions {
  ttlMs?: number;
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
}

/**
 * The model list a provider reports, cached briefly so the panel can render it on every
 * paint without a call per render.
 *
 * A provider that is down never costs the owner anything: the last successful answer is
 * served with `stale`, and if there is none the list is empty with a reason. Neither path
 * touches the stored providers or the saved defaults, and neither path substitutes a list
 * written in this repository.
 */
export class ProviderModels {
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<ProviderModelList>>();
  private readonly ttlMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly clock: Clock;

  constructor(
    private readonly services: { providers: ProviderAdmin; vault: Vault },
    private readonly fetcher: typeof globalThis.fetch = fetch,
    options: ProviderModelOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.env = options.env ?? process.env;
    this.clock = options.clock ?? Date.now;
  }

  async list(profileId: string, providerId: string): Promise<ProviderModelList> {
    const provider = (await this.services.providers.providers(profileId)).find(
      (item) => item.id === providerId && !item.revokedAt,
    );

    if (!provider) {
      throw new GatewayError(404, 'Provider not found');
    }

    const key = `${profileId}:${providerId}`;
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > this.clock()) {
      return cached.list;
    }

    const pending = this.inflight.get(key);

    if (pending) {
      return pending;
    }

    const request = this.refresh(profileId, provider, key, cached).finally(() =>
      this.inflight.delete(key),
    );

    this.inflight.set(key, request);

    return request;
  }

  private async refresh(
    profileId: string,
    provider: ProviderRecord,
    key: string,
    cached: Entry | undefined,
  ): Promise<ProviderModelList> {
    try {
      const models = await this.fetchModels(profileId, provider);
      const list: ProviderModelList = {
        providerId: provider.id,
        models,
        fetchedAt: nowIso(this.clock),
        stale: false,
      };

      if (this.cache.size >= 200) {
        this.cache.clear();
      }

      this.cache.set(key, { list, expiresAt: this.clock() + this.ttlMs });

      return list;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Provider request failed';

      // The stale copy keeps its original fetchedAt, so the panel can say how old it is.
      return {
        ...(cached?.list ?? {
          providerId: provider.id,
          models: [],
          fetchedAt: nowIso(this.clock),
        }),
        stale: true,
        reason: reason.slice(0, 300),
      };
    }
  }

  private async fetchModels(profileId: string, provider: ProviderRecord) {
    if (provider.authMode === 'codex') {
      // The ChatGPT device login talks to the Codex backend, which publishes no model index.
      throw new Error('O login ChatGPT não expõe uma lista de modelos; informe o ID do modelo.');
    }

    const kind = provider.kind as ProviderKind;
    const key = await this.apiKey(profileId, provider);
    const bearer = provider.kind === 'openai' || provider.apiKeyEnv === 'ANTHROPIC_API_TOKEN';

    const response = await this.fetcher(endpoints[kind], {
      headers: {
        accept: 'application/json',
        ...(provider.kind === 'google' ? { 'x-goog-api-key': key } : {}),
        ...(provider.kind === 'anthropic'
          ? { 'anthropic-version': '2023-06-01', ...(bearer ? {} : { 'x-api-key': key }) }
          : {}),
        ...(bearer && provider.kind !== 'google' ? { authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // The body can echo the key back; only the status is safe to surface.
      throw new Error(`O provider respondeu ${response.status} ao listar modelos.`);
    }

    return parse(kind, await response.json());
  }

  private async apiKey(profileId: string, provider: ProviderRecord) {
    if (provider.apiKeyEnv) {
      const value = this.env[provider.apiKeyEnv]?.trim();

      if (!value) {
        throw new Error('A variável de ambiente do provider não está definida.');
      }

      return value;
    }

    const secret = await this.services.vault.read(profileId, providerSecret(provider.id));

    if (!secret) {
      throw new Error('Provider key is not configured');
    }

    return secret;
  }
}
