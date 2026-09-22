import { randomUUID } from 'node:crypto';
import {
  type Profile,
  profilePatchSchema,
  profileRecordSchema,
  profileSchema,
} from '@jian/contracts';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound, GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import type { Reader, Store } from '../core/store.js';

export class Profiles {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = Date.now,
  ) {}

  async profile(id: string, reader: Reader = this.store) {
    return profileRecordSchema.parse(assertFound(await reader.get('profile', id), 'Profile'));
  }

  async profiles() {
    return (await this.store.list('profile', { limit: 100 })).map((profile) =>
      profileRecordSchema.parse(profile),
    );
  }

  async createProfile(input: unknown) {
    const data = profileSchema.parse(input);

    const profile: Profile = {
      ...data,
      id: randomUUID(),
      version: 1,
      createdAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock),
    };

    await this.store.transaction(profile.id, async (tx) => {
      await this.validateCredentials(profile, tx);
      await tx.put('profile', profile.id, profile.id, profile);

      await tx.put('revision', `${profile.id}:1`, profile.id, {
        id: `${profile.id}:1`,
        profileId: profile.id,
        profile,
        createdAt: nowIso(this.clock),
      });

      await recordEvent(tx, this.clock, profile.id, 'profile.created', {
        profileId: profile.id,
        version: 1,
      });
    });

    return profile;
  }

  /** A profile may only name credentials of its own, unrevoked and of the matching kind. */
  private async validateCredentials(profile: Profile, reader: Reader) {
    for (const names of [
      profile.skills.map((skill) => skill.name),
      profile.mcpServers.map((server) => server.name),
    ]) {
      if (new Set(names).size !== names.length) {
        throw new GatewayError(400, 'Skill and MCP names must be unique within a profile');
      }
    }

    const references = [
      { id: profile.model.credentialId, kind: 'provider' },
      ...profile.mcpServers.map((server) => ({ id: server.credentialId, kind: 'mcp' })),
    ];

    for (const reference of references) {
      if (!reference.id) {
        continue;
      }

      const credential = await reader.get('credential', reference.id);

      if (
        !credential ||
        credential.profileId !== profile.id ||
        credential.kind !== reference.kind ||
        credential.revokedAt
      ) {
        throw new GatewayError(400, 'Credential reference is not available to this profile');
      }
    }
  }

  async updateProfile(id: string, input: unknown) {
    const { expectedVersion, ...patch } = profilePatchSchema.parse(input);

    return this.store.transaction(id, async (tx) => {
      const current = await this.profile(id, tx);

      if (current.version !== expectedVersion) {
        throw new GatewayError(409, 'Profile version changed; reload before editing');
      }

      const profile: Profile = {
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: nowIso(this.clock),
      };

      await this.validateCredentials(profile, tx);
      await tx.put('profile', id, id, profile);

      const revision = {
        id: `${id}:${profile.version}`,
        profileId: id,
        profile,
        createdAt: nowIso(this.clock),
      };

      await tx.put('revision', revision.id, id, revision);

      await recordEvent(tx, this.clock, id, 'profile.updated', {
        profileId: id,
        version: profile.version,
      });

      return profile;
    });
  }

  async revisions(id: string) {
    await this.profile(id);

    return (await this.store.list('revision', { profileId: id, descending: true, limit: 50 })).map(
      (revision) => ({ ...revision, profile: profileRecordSchema.parse(revision.profile) }),
    );
  }
}
