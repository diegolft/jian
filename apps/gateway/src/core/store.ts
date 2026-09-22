import type { GatewayEvent, Kind, Records } from '../records.js';

export type Selection = {
  profileId?: string;
  where?: Record<string, unknown>;
  limit?: number;
  descending?: boolean;
  before?: string;
  search?: string;
  anyWords?: string[];
};

export interface Reader {
  get<K extends Kind>(kind: K, id: string): Promise<Records[K] | null>;
  list<K extends Kind>(kind: K, options?: Selection): Promise<Records[K][]>;
  events(profileId: string, after: number, limit?: number): Promise<GatewayEvent[]>;
}

export interface Transaction extends Reader {
  put<K extends Kind>(kind: K, id: string, profileId: string, value: Records[K]): Promise<void>;
  // Removing what is already absent is not an error: a secret may never have been stored.
  remove<K extends Kind>(kind: K, id: string, profileId: string): Promise<void>;
  event(event: Omit<GatewayEvent, 'id'>): Promise<void>;
}

export interface Store extends Reader {
  transaction<T>(profileId: string, body: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
