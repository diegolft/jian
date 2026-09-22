/** Route parameters of the gateway's path shapes, shared by the area registrars. */
export type ProfileParams = { profileId: string };

export type SessionParams = ProfileParams & { sessionId: string };

export type RunParams = ProfileParams & { runId: string };

export type ChannelParams = ProfileParams & { channelId: string };

export type MemoryParams = ProfileParams & { memoryKey: string };

export type ContactParams = ProfileParams & { contactId: string };
