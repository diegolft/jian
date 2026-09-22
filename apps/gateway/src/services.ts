import { Contexts } from './context/service.js';
import type { Clock } from './core/clock.js';
import type { Store } from './core/store.js';
import { Memories } from './memories/service.js';
import { Profiles } from './profiles/service.js';
import { Providers } from './providers/service.js';
import { RunLifecycle } from './runs/lifecycle.js';
import { Runs } from './runs/service.js';
import type { Vault } from './security/vault.js';
import { Sessions } from './sessions/service.js';

export type Services = {
  profiles: Profiles;
  providers: Providers;
  sessions: Sessions;
  memories: Memories;
  runs: Runs;
  lifecycle: RunLifecycle;
  contexts: Contexts;
  vault: Vault;
};

/** One wiring point: every area gets the same store, vault and clock. */
export function buildServices({
  store,
  vault,
  clock = Date.now,
}: {
  store: Store;
  vault: Vault;
  clock?: Clock;
}): Services {
  const profiles = new Profiles(store, vault, clock);
  const providers = new Providers(store, profiles, vault, clock);
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
    vault,
  };
}
