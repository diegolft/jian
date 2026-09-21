import type { GatewayEvent, Kind, Records } from '../../src/domain.js';
import type { Selection, Store, Transaction } from '../../src/storage.js';

export class MemoryStore implements Store {
  private records = new Map<string, { kind: Kind; profileId: string; data: Records[Kind] }>();
  private log: GatewayEvent[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  async get<K extends Kind>(kind: K, id: string): Promise<Records[K] | null> {
    return structuredClone(this.records.get(`${kind}:${id}`)?.data as Records[K] | undefined ?? null);
  }
  async list<K extends Kind>(kind: K, options: Selection = {}): Promise<Records[K][]> {
    let rows = [...this.records.values()].filter(r => r.kind === kind && (!options.profileId || r.profileId === options.profileId))
      .map(r => r.data as Records[K]).filter(r => Object.entries(options.where ?? {}).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
    if (options.descending) rows = rows.reverse();
    return structuredClone(rows.slice(0, options.limit ?? 100));
  }
  async events(profileId: string, after: number, limit = 100) { return structuredClone(this.log.filter(e => e.profileId === profileId && e.id > after).slice(0, limit)); }
  async transaction<T>(_profileId: string, body: (tx: Transaction) => Promise<T>): Promise<T> {
    const execute = async () => {
      const old = structuredClone(this.records); const oldLog = structuredClone(this.log);
      try {
        return await body({
          get: this.get.bind(this), list: this.list.bind(this), events: this.events.bind(this),
          put: async (kind, id, profileId, value) => { this.records.set(`${kind}:${id}`, { kind, profileId, data: structuredClone(value) }); },
          event: async event => { this.log.push({ ...structuredClone(event), id: this.log.length + 1 }); },
        });
      } catch (error) { this.records = old; this.log = oldLog; throw error; }
    };
    const result = this.tail.then(execute, execute); this.tail = result.catch(() => {}); return result;
  }
  async close() {}
}
