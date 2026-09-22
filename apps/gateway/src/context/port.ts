import type { Run } from '@elos/contracts';

export interface ContextSource {
  context(run: Run): Promise<{
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>;
}
