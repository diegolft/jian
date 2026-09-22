import { createElosClient, type operations } from '@elos/sdk';

type JsonResponse<
  K extends keyof operations,
  S extends keyof operations[K]['responses'],
> = operations[K]['responses'][S] extends { content: { 'application/json': infer T } } ? T : never;

export type Profile = JsonResponse<'getProfile', 200>;

export type Session = JsonResponse<'listSessions', 200>[number];

export type Channel = JsonResponse<'listChannels', 200>[number];

export type Credential = JsonResponse<'listCredentials', 200>[number];

export type AccessKey = JsonResponse<'listAccessKeys', 200>[number];

export type Memory = JsonResponse<'listMemories', 200>[number];

export type Run = JsonResponse<'getRun', 200>;

export type Delivery = JsonResponse<'listDeliveries', 200>[number];

export type Connection = JsonResponse<'getChannelConnection', 200>;

export type NewProfile = operations['createProfile']['requestBody']['content']['application/json'];

export type ProfilePatch =
  operations['updateProfile']['requestBody']['content']['application/json'];

export type NewChannel = operations['createChannel']['requestBody']['content']['application/json'];

export type NewCredential =
  operations['createCredential']['requestBody']['content']['application/json'];

export type NewKey = operations['createAccessKey']['requestBody']['content']['application/json'];

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
      const message =
        detail?.error === 'Configure a provider credential before starting a run'
          ? 'Selecione uma credencial de provider em Identidade e modelo antes de conversar.'
          : 'O estado mudou ou a sessão está ocupada. Atualize e tente novamente.';

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

/** The admin token stays in React memory. Every request goes to this gateway's own origin. */
export function gatewayApi(token: string) {
  const client = createElosClient({
    baseUrl: window.location.origin,
    token,
    fetch: (request, init) =>
      fetch(request, {
        ...init,
        cache: 'no-store',
        credentials: 'omit',
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      }),
  });

  const profile = (profileId: string) => ({ path: { profileId } });
  const channel = (profileId: string, channelId: string) => ({ path: { profileId, channelId } });

  return {
    profiles: () => result(client.GET('/v1/profiles')),
    createProfile: (body: NewProfile) => result(client.POST('/v1/profiles', { body })),
    updateProfile: (profileId: string, body: ProfilePatch) =>
      result(client.PATCH('/v1/profiles/{profileId}', { params: profile(profileId), body })),
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
    submit: (profileId: string, sessionId: string, text: string, requestKey: string) =>
      result(
        client.POST('/v1/profiles/{profileId}/sessions/{sessionId}/messages', {
          params: { path: { profileId, sessionId } },
          body: { text, requestKey },
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
    remember: (profileId: string, key: string, content: string, expectedVersion: number) =>
      result(
        client.PUT('/v1/profiles/{profileId}/memories', {
          params: profile(profileId),
          body: { key, content, expectedVersion },
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
    credentials: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/credentials', { params: profile(profileId) })),
    createCredential: (profileId: string, body: NewCredential) =>
      result(
        client.POST('/v1/profiles/{profileId}/credentials', { params: profile(profileId), body }),
      ),
    revokeCredential: (profileId: string, credentialId: string) =>
      result(
        client.DELETE('/v1/profiles/{profileId}/credentials/{credentialId}', {
          params: { path: { profileId, credentialId } },
        }),
      ),
    rotateCredential: (profileId: string, credentialId: string) =>
      result(
        client.POST('/v1/profiles/{profileId}/credentials/{credentialId}/rotate', {
          params: { path: { profileId, credentialId } },
        }),
      ),
    keys: (profileId: string) =>
      result(client.GET('/v1/profiles/{profileId}/keys', { params: profile(profileId) })),
    issueKey: (profileId: string, body: NewKey) =>
      result(client.POST('/v1/profiles/{profileId}/keys', { params: profile(profileId), body })),
    revokeKey: (profileId: string, keyId: string) =>
      result(
        client.DELETE('/v1/profiles/{profileId}/keys/{keyId}', {
          params: { path: { profileId, keyId } },
        }),
      ),
  };
}

export type GatewayApi = ReturnType<typeof gatewayApi>;

export type ProfileData = {
  sessions: Session[];
  channels: Channel[];
  credentials: Credential[];
  keys: AccessKey[];
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
