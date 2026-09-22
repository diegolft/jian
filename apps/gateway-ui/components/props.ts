import type { GatewayApi, Mutation, Profile, ProfileData } from '../lib/api';

/**
 * What the layout hands a section: the open profile, its whole screenful, the client, the
 * wrapper that reports the result of an action, and whether one is already running.
 */
export type SectionProps = {
  profile: Profile;
  data: ProfileData;
  api: GatewayApi;
  mutate: Mutation;
  busy: boolean;
};
