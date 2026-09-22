import type { Memory } from '@jian/contracts';

export interface MemoryWriter {
  memories(profileId: string): Promise<Memory[]>;
  remember(profileId: string, input: unknown, sourceSessionId?: string): Promise<Memory>;
}
