import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { Run } from './domain.js';
import { GatewayError, memorySchema } from './domain.js';
import type { Gateway } from './gateway.js';

export function profileTools(gateway: Gateway, run: Run): ToolSet {
  const tools: ToolSet = {
    list_activities: tool({
      description: 'Read the actual queued/running tasks across this profile’s sessions.',
      inputSchema: z.object({}),
      execute: async () =>
        (await gateway.activities(run.profileId)).map((r) => ({
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
      execute: async () => (await gateway.memories(run.profileId)).slice(0, 30),
    }),
    remember: tool({
      description:
        'Save a fact or decision shared by all sessions of this profile. Use expectedVersion=0 for a new key, or the current version for an update.',
      inputSchema: memorySchema,
      execute: async (input) => gateway.remember(run.profileId, input, run.sessionId),
    }),
    list_sessions: tool({
      description: 'Find other conversations belonging to this profile.',
      inputSchema: z.object({}),
      execute: async () => gateway.sessions(run.profileId),
    }),
    read_session: tool({
      description: 'Read recent messages in one of this profile’s sessions.',
      inputSchema: z.object({ sessionId: z.string().uuid() }),
      execute: async ({ sessionId }) =>
        (await gateway.messages(run.profileId, sessionId, 20)).map((m) => ({
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
        if (!skill) throw new GatewayError(404, 'Skill not found');
        return skill;
      },
    }),
  };
  if (run.profile.allowSelfManagement) {
    tools.update_identity = tool({
      description:
        'Version an update to your own identity. Applies to new runs. Cannot change permissions, credentials or providers.',
      inputSchema: z.object({
        expectedVersion: z.number().int().positive(),
        name: z.string().min(1).max(100).optional(),
        instructions: z.string().min(1).max(8000).optional(),
      }),
      execute: async (input) => {
        if (!(await gateway.profile(run.profileId)).allowSelfManagement)
          throw new GatewayError(403, 'Self-management is disabled');
        const updated = await gateway.updateProfile(run.profileId, input);
        return { id: updated.id, name: updated.name, version: updated.version };
      },
    });
    tools.read_identity = tool({
      description: 'Read the latest version of your identity before editing it.',
      inputSchema: z.object({}),
      execute: async () => {
        const p = await gateway.profile(run.profileId);
        return { id: p.id, name: p.name, instructions: p.instructions, version: p.version };
      },
    });
    tools.create_profile = tool({
      description:
        'Create a separate profile inheriting your provider. The new profile starts with no MCP servers, no skills and self-management disabled.',
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        instructions: z.string().min(1).max(8000),
      }),
      execute: async (input) => {
        if (!(await gateway.profile(run.profileId)).allowSelfManagement)
          throw new GatewayError(403, 'Self-management is disabled');
        const created = await gateway.createProfile({ ...input, model: run.profile.model });
        return { id: created.id, name: created.name };
      },
    });
  }
  return tools;
}
