import { type Client, profile } from './params';
import { result } from './result';
import type { ModelSelection } from './types';

/** Sessions, their messages and the runs a message starts. */
export const conversationCalls = (client: Client) => ({
  sessions: (profileId: string) =>
    result(client.GET('/v1/profiles/{profileId}/sessions', { params: profile(profileId) })),
  createSession: (profileId: string, channel = 'api') =>
    result(
      client.POST('/v1/profiles/{profileId}/sessions', {
        params: profile(profileId),
        body: { channel },
      }),
    ),
  renameSession: (profileId: string, sessionId: string, title: string) =>
    result(
      client.PATCH('/v1/profiles/{profileId}/sessions/{sessionId}', {
        params: { path: { profileId, sessionId } },
        body: { title },
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
});
