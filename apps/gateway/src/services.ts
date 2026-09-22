import { Contexts } from './context/service.js';
import type { Clock } from './core/clock.js';
import { Memories } from './memories/service.js';
import { Peers } from './peers/service.js';
import { Profiles } from './profiles/service.js';
import type { ModelCatalog } from './providers/catalog-source.js';
import { Providers } from './providers/service.js';
import { RunLifecycle } from './runs/lifecycle.js';
import { Runs } from './runs/service.js';
import type { Vault } from './security/vault.js';
import { Sessions } from './sessions/service.js';
import type { Store } from './storage/database.js';

export type Services = {
  profiles: Profiles;
  providers: Providers;
  sessions: Sessions;
  memories: Memories;
  runs: Runs;
  peers: Peers;
  lifecycle: RunLifecycle;
  contexts: Contexts;
  vault: Vault;
};

/** One wiring point: every area gets the same store, vault and clock. */
export function buildServices({
  store,
  vault,
  clock = Date.now,
  catalog,
}: {
  store: Store;
  vault: Vault;
  clock?: Clock;
  catalog?: ModelCatalog;
}): Services {
  const profiles = new Profiles(store, vault, clock);
  const providers = new Providers(store, profiles, vault, clock, catalog);
  const sessions = new Sessions(store, profiles, clock);
  const memories = new Memories(store, profiles, sessions, clock);
  const runs = new Runs(store, profiles, sessions, providers, clock);

  return {
    profiles,
    providers,
    sessions,
    memories,
    runs,
    peers: new Peers({ profiles, sessions, runs, store }, clock),
    lifecycle: new RunLifecycle(store, runs, clock),
    contexts: new Contexts(store, runs, sessions),
    vault,
  };
}
