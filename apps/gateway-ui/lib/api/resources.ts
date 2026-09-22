import { type Client, profile } from './params';
import { result } from './result';

/** What the agent carries between runs: what it remembers and what it knows how to do. */
export const resourceCalls = (client: Client) => ({
  memories: (profileId: string) =>
    result(client.GET('/v1/profiles/{profileId}/memories', { params: profile(profileId) })),
  forget: (profileId: string, memoryKey: string) =>
    result(
      client.DELETE('/v1/profiles/{profileId}/memories/{memoryKey}', {
        params: { path: { profileId, memoryKey } },
      }),
    ),
  skillCatalog: (profileId: string, url: string) =>
    result(
      client.GET('/v1/profiles/{profileId}/skill-catalog', {
        params: { path: { profileId }, query: { url } },
      }),
    ),
  importSkill: (profileId: string, url: string) =>
    result(
      client.POST('/v1/profiles/{profileId}/skills/import', {
        params: profile(profileId),
        body: { url },
      }),
    ),
});
