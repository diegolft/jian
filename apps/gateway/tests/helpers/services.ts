import { buildServices, type Services } from '../../src/services.js';
import { MemoryStore } from './memory-store.js';

export function testServices(clock?: () => number): Services & { store: MemoryStore } {
  const store = new MemoryStore();

  return { ...buildServices({ store, clock }), store };
}
