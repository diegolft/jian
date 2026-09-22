import { memorySchema, type Run, skillSchema } from '@elos/contracts';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { GatewayError } from './core/errors.js';
import type { Store } from './core/store.js';
import type { Memories } from './memories/service.js';
import type { Profiles } from './profiles/service.js';
import type { RunLifecycle } from './runs/lifecycle.js';
import type { Runs } from './runs/service.js';
import { Coordination } from './services/coordination.js';
import type { Sessions } from './sessions/service.js';

/** What the tool set reaches for on the profile's behalf during a run. */
export type ToolServices = {
  profiles: Profiles;
  memories: Memories;
  sessions: Sessions;
  runs: Runs;
  lifecycle: RunLifecycle;
  store: Store;
};

export function profileTools(services: ToolServices, run: Run): ToolSet {
  const coordination = new Coordination(services);

  const artifactPageChars = Math.max(
    1,
    Math.floor(((run.contextPolicy ?? run.profile.contextPolicy).toolResultTokens - 64) / 4),
  );

  const tools: ToolSet = {
    list_activities: tool({
      description: 'Read the actual queued/running tasks across this profile’s sessions.',
      inputSchema: z.object({}),
      execute: async () =>
        (await services.runs.activities(run.profileId)).map((r) => ({
          id: r.id,
          sessionId: r.sessionId,
          status: r.status,
          input: r.input.slice(0, 500),
          updatedAt: r.updatedAt,
        })),
    }),

    read_memories: tool({
      description: 'Read shared memories and their versions before changing an existing key.',
      inputSchema: z.object({}),
      execute: async () => (await services.memories.memories(run.profileId)).slice(0, 30),
    }),

    remember: tool({
      description:
        'Save a fact or decision shared by all sessions of this profile. Use expectedVersion=0 for a new key, or the current version for an update.',
      inputSchema: memorySchema,
      execute: async (input) => services.memories.remember(run.profileId, input, run.sessionId),
    }),

    list_sessions: tool({
      description: 'Find other conversations belonging to this profile.',
      inputSchema: z.object({}),
      execute: async () => services.sessions.sessions(run.profileId),
    }),

    read_session: tool({
      description: 'Read recent messages in one of this profile’s sessions.',
      inputSchema: z.object({ sessionId: z.string().uuid() }),
      execute: async ({ sessionId }) =>
        (await services.sessions.messages(run.profileId, sessionId, 20)).map((m) => ({
          role: m.role,
          content: m.content.slice(0, 2000),
          createdAt: m.createdAt,
        })),
    }),

    load_skill: tool({
      description: 'Load instructions for a skill enabled on this profile.',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const skill = run.profile.skills.find((s) => s.name === name);

        if (!skill) {
          throw new GatewayError(404, 'Skill not found');
        }

        return skill;
      },
    }),

    search_history: tool({
      description: 'Search paginated conversation history for this profile.',
      inputSchema: z.object({
        sessionId: z.string().uuid().optional(),
        before: z.string().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(20).default(10),
        q: z.string().trim().min(1).max(200).optional(),
      }),
      execute: async ({ sessionId, ...query }) =>
        coordination.history(run.profileId, sessionId, query),
    }),

    read_artifact: tool({
      description: 'Read a bounded page of a stored tool result by artifact id.',
      inputSchema: z.object({
        artifactId: z.string().uuid(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(4000).default(artifactPageChars),
      }),
      execute: async ({ artifactId, offset, limit }) => {
        const page = await coordination.artifact(run.profileId, artifactId, {
          offset,
          limit: Math.min(limit, artifactPageChars),
        });

        return { content: page.content, nextOffset: page.nextOffset };
      },
    }),

    read_run_checkpoints: tool({
      description:
        'Inspect saved results before continuing a run; unknown external effects require reconciliation.',
      inputSchema: z.object({ runId: z.string().uuid() }),
      execute: async ({ runId }) =>
        (await services.lifecycle.checkpoints(run.profileId, runId)).map((checkpoint) => {
          const data =
            checkpoint.data && typeof checkpoint.data === 'object'
              ? (checkpoint.data as Record<string, unknown>)
              : {};

          return {
            id: checkpoint.id,
            createdAt: checkpoint.createdAt,
            phase: data.phase,
            toolName: data.toolName,
            toolCallId: data.toolCallId,
            finishReason: data.finishReason,
            usage: data.usage,
            tools: Array.isArray(data.tools)
              ? data.tools.map((item: unknown) => {
                  const tool = item as Record<string, unknown>;

                  return {
                    toolName: tool.toolName,
                    toolCallId: tool.toolCallId,
                    artifactId: tool.artifactId,
                    bytes: tool.bytes,
                    result: tool.result,
                  };
                })
              : undefined,
          };
        }),
    }),

    send_session_message: tool({
      description: 'Send one idempotent message to another session of this profile.',
      inputSchema: z.object({
        toSessionId: z.string().uuid(),
        text: z.string().trim().min(1).max(4000),
        requestKey: z.string().min(1).max(120),
      }),
      execute: async (input) =>
        coordination.send(run.profileId, { ...input, fromSessionId: run.sessionId }),
    }),

    read_inbox: tool({
      description: 'Read messages sent to this session.',
      inputSchema: z.object({}),
      execute: async () => coordination.inbox(run.profileId, run.sessionId),
    }),

    acquire_resource: tool({
      description:
        'Acquire or renew a profile resource lease before exclusive work. Keep its fence.',
      inputSchema: z.object({
        resource: z.string().regex(/^[a-zA-Z0-9_./:-]{1,200}$/),
        ttlSeconds: z.number().int().min(5).max(300).default(60),
      }),
      execute: async (input) =>
        coordination.acquire(run.profileId, { ...input, sessionId: run.sessionId }),
    }),

    release_resource: tool({
      description: 'Release only this session’s current resource lease using its fence.',
      inputSchema: z.object({
        resource: z.string().regex(/^[a-zA-Z0-9_./:-]{1,200}$/),
        fence: z.number().int().positive(),
      }),
      execute: async (input) =>
        coordination.release(run.profileId, { ...input, sessionId: run.sessionId }),
    }),
  };

  if (run.profile.allowSelfManagement) {
    tools.update_skills = tool({
      description:
        'Version your skill instructions for future runs. Cannot change MCPs, credentials or permissions.',
      inputSchema: z.object({
        expectedVersion: z.number().int().positive(),
        skills: z.array(skillSchema).max(20),
      }),
      execute: async (input) => {
        if (!(await services.profiles.profile(run.profileId)).allowSelfManagement) {
          throw new GatewayError(403, 'Self-management is disabled');
        }

        const updated = await services.profiles.updateProfile(run.profileId, input);

        return {
          version: updated.version,
          skills: updated.skills.map(({ name, description }) => ({ name, description })),
        };
      },
    });

    tools.update_identity = tool({
      description:
        'Version an update to your own identity. Applies to new runs. Cannot change permissions, credentials or providers.',
      inputSchema: z.object({
        expectedVersion: z.number().int().positive(),
        name: z.string().min(1).max(100).optional(),
        instructions: z.string().min(1).max(8000).optional(),
        identity: z
          .object({
            role: z.string().max(1000),
            tone: z.string().max(1000),
            goals: z.array(z.string().max(500)).max(10),
            boundaries: z.array(z.string().max(500)).max(10),
          })
          .optional(),
      }),
      execute: async (input) => {
        if (!(await services.profiles.profile(run.profileId)).allowSelfManagement) {
          throw new GatewayError(403, 'Self-management is disabled');
        }

        const updated = await services.profiles.updateProfile(run.profileId, input);

        return { id: updated.id, name: updated.name, version: updated.version };
      },
    });

    tools.read_identity = tool({
      description: 'Read the latest version of your identity before editing it.',
      inputSchema: z.object({}),
      execute: async () => {
        const p = await services.profiles.profile(run.profileId);

        return {
          id: p.id,
          name: p.name,
          instructions: p.instructions,
          identity: p.identity,
          version: p.version,
        };
      },
    });

    tools.create_profile = tool({
      description:
        'Create a separate profile without credential access. An administrator must configure its provider credential before it can run.',
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        instructions: z.string().min(1).max(8000),
      }),
      execute: async (input) => {
        if (!(await services.profiles.profile(run.profileId)).allowSelfManagement) {
          throw new GatewayError(403, 'Self-management is disabled');
        }

        const { apiKeyEnv: _env, credentialId: _credential, ...model } = run.profile.model;
        const created = await services.profiles.createProfile({ ...input, model });

        return { id: created.id, name: created.name };
      },
    });
  }

  return tools;
}
