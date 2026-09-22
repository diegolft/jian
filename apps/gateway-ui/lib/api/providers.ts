import { type Client, profile } from './params';
import { result } from './result';
import type { ModelDefaultsInput, NewProvider } from './types';

/** Credentials per vendor, the models each one answers with, and the roles they are bound to. */
export const providerCalls = (client: Client) => ({
  providers: (profileId: string) =>
    result(client.GET('/v1/profiles/{profileId}/providers', { params: profile(profileId) })),
  createProvider: (profileId: string, body: NewProvider) =>
    result(client.POST('/v1/profiles/{profileId}/providers', { params: profile(profileId), body })),
  revokeProvider: (profileId: string, providerId: string) =>
    result(
      client.DELETE('/v1/profiles/{profileId}/providers/{providerId}', {
        params: { path: { profileId, providerId } },
      }),
    ),
  providerModels: (profileId: string, providerId: string) =>
    result(
      client.GET('/v1/profiles/{profileId}/providers/{providerId}/models', {
        params: { path: { profileId, providerId } },
      }),
    ),
  startCodexLogin: (profileId: string) =>
    result(
      client.POST('/v1/profiles/{profileId}/providers/openai/oauth', {
        params: profile(profileId),
      }),
    ),
  codexLogin: (profileId: string) =>
    result(
      client.GET('/v1/profiles/{profileId}/providers/openai/oauth', { params: profile(profileId) }),
    ),
  modelDefaults: (profileId: string) =>
    result(client.GET('/v1/profiles/{profileId}/model-defaults', { params: profile(profileId) })),
  setModelDefaults: (profileId: string, body: ModelDefaultsInput) =>
    result(
      client.PUT('/v1/profiles/{profileId}/model-defaults', { params: profile(profileId), body }),
    ),
});
