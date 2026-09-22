import { Contexts } from './context/service.js';
import type { Clock } from './core/clock.js';
import type { Store } from './core/store.js';
import { Memories } from './memories/service.js';
import { Profiles } from './profiles/service.js';
import { Providers } from './providers/service.js';
import { RunLifecycle } from './runs/lifecycle.js';
import { Runs } from './runs/service.js';
import { Sessions } from './sessions/service.js';

export type Services = {
  profiles: Profiles;
  providers: Providers;
  sessions: Sessions;
  memories: Memories;
  runs: Runs;
  lifecycle: RunLifecycle;
  contexts: Contexts;
};

/** One wiring point: every area gets the same store and the same clock. */
export function buildServices({
  store,
  clock = Date.now,
}: {
  store: Store;
  clock?: Clock;
}): Services {
  const profiles = new Profiles(store, clock);
  const providers = new Providers(store, profiles, clock);
  const sessions = new Sessions(store, profiles, clock);
  const memories = new Memories(store, profiles, sessions, clock);
  const runs = new Runs(store, profiles, sessions, providers, clock);

  return {
    profiles,
    providers,
    sessions,
    memories,
    runs,
    lifecycle: new RunLifecycle(store, runs, clock),
    contexts: new Contexts(store, runs, sessions),
  };
}
