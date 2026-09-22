import { createJianClient, type operations } from '@jian/sdk';

type JsonResponse<
  K extends keyof operations,
  S extends keyof operations[K]['responses'],
> = operations[K]['responses'][S] extends { content: { 'application/json': infer T } } ? T : never;

export type Profile = JsonResponse<'getProfile', 200>;

export type Session = JsonResponse<'listSessions', 200>[number];

export type Channel = JsonResponse<'listChannels', 200>[number];

export type Provider = JsonResponse<'listProviders', 200>[number];
export type ModelDefaults = JsonResponse<'getModelDefaults', 200>;
export type ModelDefaultsInput =
  operations['setModelDefaults']['requestBody']['content']['application/json'];
export type ModelSelection = NonNullable<ModelDefaults['conversation']>;
export type ReasoningEffort = NonNullable<ModelSelection['reasoningEffort']>;
export type ProviderModelList = JsonResponse<'listProviderModels', 200>;
export type ProviderModel = ProviderModelList['models'][number];

export type Memory = JsonResponse<'listMemories', 200>[number];

export type Run = JsonResponse<'getRun', 200>;

export type Delivery = JsonResponse<'listDeliveries', 200>[number];

export type Connection = JsonResponse<'getChannelConnection', 200>;

export type NewProfile = operations['createProfile']['requestBody']['content']['application/json'];

export type ProfilePatch =
  operations['updateProfile']['requestBody']['content']['application/json'];

export type NewChannel = operations['createChannel']['requestBody']['content']['application/json'];

export type NewProvider =
  operations['createProvider']['requestBody']['content']['application/json'];

async function result<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await request;

  if (!response.ok || data === undefined) {
    if (response.status === 401) {
      throw new Error('Token inválido ou expirado. Entre novamente.');
    }

    if (response.status === 403) {
      throw new Error('Esta ação exige o token de administrador.');
    }

    const detail = error as
      | { error?: string; issues?: Array<{ path: string; message: string }> }
      | undefined;

    if (response.status === 409) {
      const conflicts: Record<string, string> = {
        'Choose a default model before starting a run':
          'Escolha um modelo padrão em Modelos padrão antes de conversar.',
        'This model does not accept the selected reasoning effort':
          'Este modelo não aceita o nível de esforço escolhido.',
        'Reasoning effort is not catalogued for this model':
          'O nível de esforço deste modelo não está catalogado no gateway.',
      };

      const message =
        conflicts[detail?.error ?? ''] ??
        'O estado mudou ou a sessão está ocupada. Atualize e tente novamente.';

      throw new Error(message);
    }

    if (response.status === 429) {
      throw new Error(
        'Limite de solicitações atingido. Aguarde um minuto antes de tentar novamente.',
      );
    }

    if (detail?.issues?.length) {
      throw new Error(`Confira os campos: ${detail.issues.map((issue) => issue.path).join(', ')}.`);
    }

    throw new Error(
      detail?.error ?? `Não foi possível concluir a solicitação (${response.status}).`,
    );
  }

  return data;
}

/**
 * The panel never holds the host token: it trades it for a signed cookie the browser keeps and
 * no script can read. The header is what stops that cookie from working from another origin.
 */
export function gatewayApi() {
  const client = createJianClient({
    baseUrl: window.location.origin,
    headers: { 'x-jian-panel': '1' },
    fetch: (request, init) =>
      fetch(request, {
        ...init,
        cache: 'no-store',
        credentials: 'same-origin',
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      }),
  });

  const profile = (profileId: string) => ({ path: { profileId } });
  const channel = (profileId: string, channelId: string) => ({ path: { profileId, channelId } });

  return {
    signIn: (token: string) => result(client.POST('/v1/panel/session', { body: { token } })),
    signOut: () => result(client.DELETE('/v1/panel/session')),
    profiles: () => result(client.GET('/v1/profiles')),
    createProfile: (body: NewProfile) => result(client.POST('/v1/profiles', { body })),
    updateProfile: (profileId: string, body: ProfilePatch) =>
      result(client.PATCH('/v1/profiles/{profileId}', { params: profile(profileId), body })),
    providers: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/providers', { params: profile(profileId) })),
    startCodexLogin: (profileId: string) =>
      result(
        client.POST('/v1/profiles/{profileId}/providers/openai/oauth', {
          params: profile(profileId),
        }),
      ),
    codexLogin: (profileId: string) =>
      result(
        client.GET('/v1/profiles/{profileId}/providers/openai/oauth', {
          params: profile(profileId),
        }),
      ),
    createProvider: (profileId: string, body: NewProvider) =>
      result(
        client.POST('/v1/profiles/{profileId}/providers', {
          params: profile(profileId),
          body,
        }),
      ),
    providerModels: (profileId: string, providerId: string) =>
      result(
        client.GET('/v1/profiles/{profileId}/providers/{providerId}/models', {
          params: { path: { profileId, providerId } },
        }),
      ),
    revokeProvider: (profileId: string, providerId: string) =>
      result(
        client.DELETE('/v1/profiles/{profileId}/providers/{providerId}', {
          params: { path: { profileId, providerId } },
        }),
      ),
    modelDefaults: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/model-defaults', { params: profile(profileId) })),
    setModelDefaults: (profileId: string, body: ModelDefaultsInput) =>
      result(
        client.PUT('/v1/profiles/{profileId}/model-defaults', {
          params: profile(profileId),
          body,
        }),
      ),
    sessions: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/sessions', { params: profile(profileId) })),
    createSession: (profileId: string, title: string, channel = 'api') =>
      result(
        client.POST('/v1/profiles/{profileId}/sessions', {
          params: profile(profileId),
          body: { title, channel },
        }),
      ),
    messages: (profileId: string, sessionId: string) =>
      result(
        client.GET('/v1/profiles/{profileId}/sessions/{sessionId}/messages', {
          params: { path: { profileId, sessionId } },
        }),
      ),
    submit: (
      profileId: string,
      sessionId: string,
      text: string,
      requestKey: string,
      model?: ModelSelection,
    ) =>
      result(
        client.POST('/v1/profiles/{profileId}/sessions/{sessionId}/messages', {
          params: { path: { profileId, sessionId } },
          body: { text, requestKey, ...(model ? { model } : {}) },
        }),
      ),
    run: (profileId: string, runId: string) =>
      result(
        client.GET('/v1/profiles/{profileId}/runs/{runId}', {
          params: { path: { profileId, runId } },
        }),
      ),
    cancel: (profileId: string, runId: string) =>
      result(
        client.POST('/v1/profiles/{profileId}/runs/{runId}/cancel', {
          params: { path: { profileId, runId } },
        }),
      ),
    activities: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/activities', { params: profile(profileId) })),
    memories: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/memories', { params: profile(profileId) })),
    forget: (profileId: string, memoryKey: string) =>
      result(
        client.DELETE('/v1/profiles/{profileId}/memories/{memoryKey}', {
          params: { path: { profileId, memoryKey } },
        }),
      ),
    channels: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/channels', { params: profile(profileId) })),
    createChannel: (profileId: string, body: NewChannel) =>
      result(
        client.POST('/v1/profiles/{profileId}/channels', { params: profile(profileId), body }),
      ),
    revokeChannel: (profileId: string, channelId: string) =>
      result(
        client.DELETE('/v1/profiles/{profileId}/channels/{channelId}', {
          params: channel(profileId, channelId),
        }),
      ),
    deliveries: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/deliveries', { params: profile(profileId) })),
    connect: (profileId: string, channelId: string) =>
      result(
        client.POST('/v1/profiles/{profileId}/channels/{channelId}/connect', {
          params: channel(profileId, channelId),
        }),
      ),
    connection: (profileId: string, channelId: string) =>
      result(
        client.GET('/v1/profiles/{profileId}/channels/{channelId}/connection', {
          params: channel(profileId, channelId),
        }),
      ),
    qr: (profileId: string, channelId: string) =>
      result(
        client.GET('/v1/profiles/{profileId}/channels/{channelId}/qr', {
          params: channel(profileId, channelId),
        }),
      ),
    disconnect: (profileId: string, channelId: string) =>
      result(
        client.POST('/v1/profiles/{profileId}/channels/{channelId}/disconnect', {
          params: channel(profileId, channelId),
        }),
      ),
  };
}

export type GatewayApi = ReturnType<typeof gatewayApi>;

export type ProfileData = {
  providers: Provider[];
  /** One entry per usable provider, keyed by provider id. Absent while a list never arrived. */
  providerModels: Record<string, ProviderModelList>;
  modelDefaults: ModelDefaults;
  sessions: Session[];
  channels: Channel[];
  memories: Memory[];
  activities: Run[];
  deliveries: Delivery[];
};

export type Mutation = (action: () => Promise<unknown>, message?: string) => Promise<boolean>;

export const lines = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
