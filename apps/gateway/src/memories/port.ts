import type { Memory } from '@elos/contracts';

export interface MemoryWriter {
  memories(profileId: string): Promise<Memory[]>;
  remember(profileId: string, input: unknown, sourceSessionId?: string): Promise<Memory>;
}
