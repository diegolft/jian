import {
  AGENT_CALL_DEPTH_LIMIT,
  type AgentAnswer,
  type AgentCallOrigin,
  type AgentCard,
  agentCallSchema,
  type Run,
} from '@jian/contracts';
import type { Clock } from '../core/clock.js';
import { GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Store } from '../core/store.js';
import type { ProfileAdmin } from '../profiles/port.js';
import type { RunWriter } from '../runs/port.js';
import type { PeerSessions } from '../sessions/port.js';
import type { PeerAgents } from './port.js';

type PeerServices = {
  profiles: ProfileAdmin;
  sessions: PeerSessions;
  runs: RunWriter;
  store: Store;
};

/** How long a caller waits for a colleague and how often it looks, in milliseconds. */
export type PeerTiming = { answerWithin: number; pollEvery: number };

const defaultTiming: PeerTiming = { answerWithin: 300_000, pollEvery: 250 };

/**
 * Conversation between the profiles of one installation. The wall between them is made of
 * data, not of distance: the caller sends text and receives text, and every other record —
 * memories, credentials, sessions, history — stays on the side that owns it. The call becomes
 * an ordinary run on the called profile, with its own key, its own context and its own lease.
 */
export class Peers implements PeerAgents {
  constructor(
    private readonly services: PeerServices,
    private readonly clock: Clock = Date.now,
    private readonly timing: PeerTiming = defaultTiming,
  ) {}

  /** Name and summary: what an agent does, never how it was told to do it. */
  async agents(profileId: string): Promise<AgentCard[]> {
    return (await this.services.profiles.profiles())
      .filter((profile) => profile.id !== profileId)
      .map(({ id, name, summary }) => ({ id, name, summary }));
  }

  async ask(run: Run, input: unknown, signal?: AbortSignal): Promise<AgentAnswer> {
    const data = agentCallSchema.parse(input);
    const origin = this.address(run, data.toProfileId);
    const callee = await this.services.profiles.profile(data.toProfileId);

    const session = await this.services.sessions.peerSession(
      callee.id,
      run.profileId,
      `Agente · ${run.profile.name}`,
    );

    // Both sides record the call so the owner can audit who spoke to whom. A retried request
    // key records the attempt again and still reaches the single run the first one created.
    await this.record(run.profileId, run.id, 'agent.call.sent', {
      toProfileId: callee.id,
      toName: callee.name,
      depth: origin.depth,
    });

    const answering = await this.services.runs.submit(
      callee.id,
      session.id,
      { text: data.text, requestKey: data.requestKey },
      { call: origin },
    );

    await this.record(callee.id, answering.id, 'agent.call.received', {
      fromProfileId: origin.fromProfileId,
      fromName: origin.fromName,
      sessionId: session.id,
      depth: origin.depth,
    });

    return {
      fromProfileId: callee.id,
      fromName: callee.name,
      text: await this.answer(callee.id, answering.id, callee.name, signal),
    };
  }

  /**
   * Where the call sits in its chain. Two limits end a conversation that would otherwise cost
   * money forever: the depth budget, inherited from the run that is asking rather than reset
   * at each hop, and the chain itself — an agent that already answered here is not asked
   * again, so nobody reopens what they closed and no circle can form.
   */
  private address(run: Run, toProfileId: string): AgentCallOrigin {
    const chain = run.call?.chain ?? [run.profileId];
    const depth = (run.call?.depth ?? 0) + 1;

    if (toProfileId === run.profileId) {
      throw new GatewayError(400, 'An agent cannot call itself');
    }

    if (depth > AGENT_CALL_DEPTH_LIMIT) {
      throw new GatewayError(
        429,
        `Agent call budget spent: this conversation is already ${AGENT_CALL_DEPTH_LIMIT} calls deep. Answer with what you have.`,
      );
    }

    if (chain.includes(toProfileId)) {
      throw new GatewayError(
        409,
        'That agent already spoke in this conversation and will not be asked again. Answer with what you have.',
      );
    }

    return {
      fromProfileId: run.profileId,
      fromName: run.profile.name,
      fromRunId: run.id,
      depth,
      chain: [...chain, toProfileId],
    };
  }

  /**
   * The answer is the run's own output, read from the called profile's record. Waiting rather
   * than executing keeps the run where it belongs: the worker that owns that profile runs it,
   * with its lease, its checkpoints and its recovery. A caller that gives up leaves the run
   * alive; it is the called profile's work, not the caller's.
   */
  private async answer(
    profileId: string,
    runId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const deadline = this.clock() + this.timing.answerWithin;

    for (;;) {
      const current = await this.services.runs.run(profileId, runId);

      if (current.status === 'completed') {
        return current.output ?? '';
      }

      if (current.status !== 'queued' && current.status !== 'running') {
        throw new GatewayError(502, `${name} could not answer: ${current.error ?? current.status}`);
      }

      signal?.throwIfAborted();

      if (this.clock() >= deadline) {
        throw new GatewayError(504, `${name} did not answer in time; its run is still going.`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.timing.pollEvery));
    }
  }

  private async record(profileId: string, runId: string, type: string, data: unknown) {
    await this.services.store.transaction(profileId, (tx) =>
      recordEvent(tx, this.clock, profileId, type, data, runId),
    );
  }
}
