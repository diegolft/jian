import type { ModelCapabilities } from '@jian/contracts';
import type { ProviderKind } from './catalog.js';

/**
 * Bump whenever a row changes, so a support question about a wrong ceiling can be answered
 * with the table the installation was running.
 */
export const capabilityTableVersion = '2026-09-22b';

type Entry = Omit<ModelCapabilities, 'known'>;

/**
 * Which models exist comes from the provider. What each one can do does not: no provider
 * listing reports context window, output ceiling, accepted reasoning efforts and input
 * modalities together and reliably, so they live here, versioned with the code.
 *
 * Keys are family prefixes. A dated snapshot such as `claude-sonnet-4-5-20250929` matches the
 * longest key that prefixes it, so a new snapshot of a known family inherits its row instead
 * of falling to the floor below. A model with no row is still offered — with `known: false`.
 */
const table: Record<ProviderKind, Record<string, Entry>> = {
  // Empty on purpose: the router reports every model's limits itself, so a row here could
  // only contradict it.
  openrouter: {},
  openai: {
    'gpt-3.5-turbo': {
      contextWindow: 16_385,
      maxOutputTokens: 4096,
      reasoningEfforts: [],
      inputModalities: ['text'],
    },
    'gpt-4-turbo': {
      contextWindow: 128_000,
      maxOutputTokens: 4096,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'gpt-4o': {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'gpt-4o-mini': {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'gpt-4.1': {
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'gpt-4.1-mini': {
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'gpt-4.1-nano': {
      contextWindow: 1_047_576,
      maxOutputTokens: 32_768,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    o1: {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'o3-mini': {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text'],
    },
    o3: {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'o4-mini': {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'gpt-5': {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'gpt-5-mini': {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'gpt-5-nano': {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'gpt-5.1': {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
    'gpt-5.1-codex': {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image'],
    },
  },
  anthropic: {
    'claude-3-haiku': {
      contextWindow: 200_000,
      maxOutputTokens: 4096,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'claude-3-opus': {
      contextWindow: 200_000,
      maxOutputTokens: 4096,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'claude-3-5-haiku': {
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      reasoningEfforts: [],
      inputModalities: ['text', 'image'],
    },
    'claude-3-5-sonnet': {
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      reasoningEfforts: [],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-3-7-sonnet': {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-sonnet-5': {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-5': {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-4-6': {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-4-7': {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-4-8': {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-sonnet-4-6': {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-haiku-4-5': {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-sonnet-4': {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-sonnet-4-5': {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-4': {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-4-1': {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
    'claude-opus-4-5': {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'pdf'],
    },
  },
  google: {
    'gemini-1.5-flash': {
      contextWindow: 1_048_576,
      maxOutputTokens: 8192,
      reasoningEfforts: [],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
    'gemini-1.5-pro': {
      contextWindow: 2_097_152,
      maxOutputTokens: 8192,
      reasoningEfforts: [],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
    'gemini-2.0-flash': {
      contextWindow: 1_048_576,
      maxOutputTokens: 8192,
      reasoningEfforts: [],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
    'gemini-2.5-flash': {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
    'gemini-2.5-flash-lite': {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      reasoningEfforts: ['none', 'low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
    'gemini-2.5-pro': {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      reasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
    'gemini-3-pro': {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      reasoningEfforts: ['low', 'high'],
      inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    },
  },
};

/**
 * Small enough that a wrong guess cannot turn into an oversized request, large enough to hold
 * a real conversation. No reasoning effort is offered, because offering one we cannot confirm
 * would fail at the provider instead of here.
 */
/**
 * What an uncatalogued model is assumed to hold. Small enough to be safe on a modest model,
 * large enough that a run with a system prompt and a tool list still fits: below this the
 * gateway refuses the turn itself and the owner never reaches the provider's own error.
 */
const floor: Entry = {
  contextWindow: 128_000,
  maxOutputTokens: 8192,
  reasoningEfforts: [],
  inputModalities: ['text'],
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(value)));

/** Gemini publishes `models/<id>`; the table and every selection use the bare id. */
export const bareModelId = (id: string) => id.replace(/^models\//, '');

/**
 * `reported` is what the provider's own listing said. Token limits alone (Gemini) beat the
 * floor but leave the model uncatalogued, because efforts and modalities are still unknown.
 * A listing that reports all four (OpenRouter) is authoritative and needs no table row.
 */
export function modelCapabilities(
  kind: ProviderKind,
  modelId: string,
  reported?: {
    contextWindow?: number;
    maxOutputTokens?: number;
    reasoningEfforts?: ModelCapabilities['reasoningEfforts'];
    inputModalities?: ModelCapabilities['inputModalities'];
  },
): ModelCapabilities {
  const id = bareModelId(modelId);

  if (reported?.contextWindow && reported.inputModalities?.length) {
    return {
      contextWindow: clamp(reported.contextWindow, 4096, 20_000_000),
      maxOutputTokens: clamp(reported.maxOutputTokens ?? floor.maxOutputTokens, 256, 1_000_000),
      reasoningEfforts: reported.reasoningEfforts ?? [],
      inputModalities: reported.inputModalities,
      known: true,
    };
  }

  const matched = Object.entries(table[kind])
    .filter(([key]) => id === key || id.startsWith(`${key}-`))
    .sort(([a], [b]) => b.length - a.length)[0];

  if (matched) {
    return { ...matched[1], known: true };
  }

  return {
    ...floor,
    contextWindow: reported?.contextWindow
      ? clamp(reported.contextWindow, 4096, 20_000_000)
      : floor.contextWindow,
    maxOutputTokens: reported?.maxOutputTokens
      ? clamp(reported.maxOutputTokens, 256, 1_000_000)
      : floor.maxOutputTokens,
    known: false,
  };
}
