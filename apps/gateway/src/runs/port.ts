import type { Checkpoint, Run } from '@elos/contracts';
import type { Reader } from '../core/store.js';

export interface RunReader {
  run(profileId: string, runId: string, reader?: Reader): Promise<Run>;
  activities(profileId: string): Promise<Run[]>;
}

export interface RunWriter extends RunReader {
  submit(
    profileId: string,
    sessionId: string,
    input: unknown,
    continuationOf?: string,
    activity?: 'conversation' | 'channel',
  ): Promise<Run>;
}

/** The lease side of a run: every write here needs the owner that holds it. */
export interface RunExecution {
  claim(runId: string, profileId: string, owner: string): Promise<Run | null>;
  heartbeat(profileId: string, runId: string, owner: string): Promise<void>;
  checkpoint(profileId: string, runId: string, owner: string, data: unknown): Promise<void>;
  checkpoints(profileId: string, runId: string): Promise<Checkpoint[]>;
  recordUsage(
    profileId: string,
    runId: string,
    owner: string,
    usage: { inputTokens: number; outputTokens: number; steps: number },
  ): Promise<void>;
  finish(
    profileId: string,
    runId: string,
    owner: string,
    status: 'completed' | 'failed' | 'interrupted',
    content: string,
  ): Promise<Run>;
}

export interface RunRecovery {
  recover(): Promise<void>;
}
