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
import type { Reader, Store, Transaction } from '../core/store.js';
import { environmentProvider, type ProviderKind, providerCatalog } from '../providers/catalog.js';
import type { Vault } from '../security/vault.js';

/** Where an MCP server's bearer token lives in the vault, addressed by the server's name. */
export const mcpSecret = (name: string) => `mcp:${name}`;

export class Profiles {
  constructor(
    private readonly store: Store,
    private readonly vault: Vault,
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

    return this.store.transaction(profile.id, async (tx) => {
      await this.validateReferences(profile, tx);
      const stored = await this.storeMcpTokens(profile, undefined, tx);

      await tx.put('profile', stored.id, stored.id, stored);

      await tx.put('revision', `${stored.id}:1`, stored.id, {
        id: `${stored.id}:1`,
        profileId: stored.id,
        profile: stored,
        createdAt: nowIso(this.clock),
      });

      await recordEvent(tx, this.clock, stored.id, 'profile.created', {
        profileId: stored.id,
        version: 1,
      });

      return stored;
    });
  }

  /**
   * An MCP token is typed with its server and kept out of the profile document, which is
   * readable by every client and versioned into revisions. A patch that omits the token keeps
   * the stored one; dropping the server drops its token.
   */
  private async storeMcpTokens(
    profile: Profile,
    previous: Profile | undefined,
    tx: Transaction,
  ): Promise<Profile> {
    const mcpServers = [];

    for (const server of profile.mcpServers) {
      const { bearerToken, ...rest } = server;

      if (bearerToken) {
        await this.vault.put(profile.id, mcpSecret(rest.name), bearerToken, tx);
      }

      mcpServers.push(rest);
    }

    for (const stale of previous?.mcpServers ?? []) {
      if (!mcpServers.some((server) => server.name === stale.name)) {
        await this.vault.discard(profile.id, mcpSecret(stale.name), tx);
      }
    }

    return { ...profile, mcpServers };
  }

  /** A profile may only name its own live provider, and one capability per name. */
  private async validateReferences(profile: Profile, reader: Reader) {
    for (const names of [
      profile.skills.map((skill) => skill.name),
      profile.mcpServers.map((server) => server.name),
    ]) {
      if (new Set(names).size !== names.length) {
        throw new GatewayError(400, 'Skill and MCP names must be unique within a profile');
      }
    }

    const providerId = profile.model.providerId;

    if (!providerId) {
      return;
    }

    const provider = await reader.get('provider', providerId);

    const fromEnvironment = (Object.keys(providerCatalog) as ProviderKind[]).some(
      (kind) => environmentProvider(profile.id, kind)?.id === providerId,
    );

    if (
      !fromEnvironment &&
      (!provider || provider.profileId !== profile.id || provider.revokedAt)
    ) {
      throw new GatewayError(400, 'Provider reference is not available to this profile');
    }
  }

  async updateProfile(id: string, input: unknown) {
    const { expectedVersion, ...patch } = profilePatchSchema.parse(input);

    return this.store.transaction(id, async (tx) => {
      const current = await this.profile(id, tx);

      if (current.version !== expectedVersion) {
        throw new GatewayError(409, 'Profile version changed; reload before editing');
      }

      const patched: Profile = {
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: nowIso(this.clock),
      };

      await this.validateReferences(patched, tx);
      const profile = await this.storeMcpTokens(patched, current, tx);

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
