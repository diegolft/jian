import type { ProfileData, ProviderModel, ReasoningEffort } from '../../lib/api';

/** The vendors the panel offers, and the host variable each one reads when no key is saved. */
export const providers = [
  {
    kind: 'openrouter',
    name: 'OpenRouter',
    variables: 'OPENROUTER_API_KEY',
  },
  {
    kind: 'anthropic',
    name: 'Anthropic',
    variables: 'ANTHROPIC_API_KEY ou ANTHROPIC_API_TOKEN',
  },
  { kind: 'google', name: 'Gemini', variables: 'GEMINI_API_TOKEN' },
  { kind: 'openai', name: 'OpenAI', variables: 'OPENAI_API_KEY' },
] as const;

/**
 * The activities that can pin a model. `runtime: false` is deliberate and visible: the gateway
 * stores and validates the choice, and nothing executes it yet.
 */
export const roles = [
  {
    key: 'conversation',
    label: 'Conversas',
    hint: 'Usado no painel e na API quando nenhum modelo é indicado.',
    runtime: true,
  },
  {
    key: 'channel',
    label: 'Canais',
    hint: 'WhatsApp, Telegram e webhooks. Sem escolha, usa o padrão de conversas.',
    runtime: true,
  },
  {
    key: 'compaction',
    label: 'Compactação de contexto',
    hint: 'Resumirá o histórico quando a conversa passar do orçamento.',
    runtime: false,
  },
  {
    key: 'image',
    label: 'Geração de imagem',
    hint: 'Modelo que produzirá imagens a pedido do agente.',
    runtime: false,
  },
  {
    key: 'audio',
    label: 'Geração de áudio',
    hint: 'Modelo que produzirá som que não é fala.',
    runtime: false,
  },
  {
    key: 'speech',
    label: 'Fala a partir de texto',
    hint: 'Modelo que lerá em voz alta uma resposta escrita.',
    runtime: false,
  },
  {
    key: 'transcription',
    label: 'Texto a partir de fala',
    hint: 'Modelo que transcreverá áudio recebido nos canais.',
    runtime: false,
  },
] as const;

export type Role = (typeof roles)[number]['key'];

export const efforts: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: 'Sem raciocínio' },
  { value: 'minimal', label: 'Mínimo' },
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
];

/** A live provider carries its own key: revoking it takes the key with it. */
export const usableProviders = (data: ProfileData) =>
  data.providers.filter((provider) => !provider.revokedAt);

/**
 * Every model the configured accounts actually reported, as the gateway last heard it. An
 * empty result means no provider answered — never that the panel has nothing to show.
 */
export const availableModels = (data: ProfileData) =>
  usableProviders(data).flatMap((provider) =>
    (data.providerModels[provider.id]?.models ?? []).map((model) => ({ provider, model })),
  );

export const modelLabel = (model: ProviderModel) =>
  `${model.displayName ?? model.id}${model.known ? '' : ' · capacidades desconhecidas'}`;
