import type { GatewayEvent, Kind, Records } from './domain.js';
export type Selection = {
  profileId?: string;
  where?: Record<string, unknown>;
  limit?: number;
  descending?: boolean;
};
export interface Reader {
  get<K extends Kind>(kind: K, id: string): Promise<Records[K] | null>;
  list<K extends Kind>(kind: K, options?: Selection): Promise<Records[K][]>;
  events(profileId: string, after: number, limit?: number): Promise<GatewayEvent[]>;
}
export interface Transaction extends Reader {
  put<K extends Kind>(kind: K, id: string, profileId: string, value: Records[K]): Promise<void>;
  event(event: Omit<GatewayEvent, 'id'>): Promise<void>;
}
export interface Store extends Reader {
  transaction<T>(profileId: string, body: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
