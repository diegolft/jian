import type { Run } from '@jian/contracts';

export interface ContextSource {
  context(run: Run): Promise<{
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>;
}
