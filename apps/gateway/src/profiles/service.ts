import { randomUUID } from 'node:crypto';
import { type Profile, profilePatchSchema, profileSchema } from '@jian/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { type Clock, nowIso } from '../core/clock.js';
import { assertFound, GatewayError } from '../core/errors.js';
import { recordEvent } from '../core/events.js';
import { environmentProvider, type ProviderKind, providerCatalog } from '../providers/catalog.js';
import type { Vault } from '../security/vault.js';
import type { Queryable, Store } from '../storage/database.js';
import { providers } from '../storage/schema.js';
import {
  findProfile,
  insertProfile,
  insertRevision,
  listProfiles,
  listRevisions,
  updateProfileRow,
} from './repository.js';

/** Where an MCP server's bearer token lives in the vault, addressed by the server's name. */
export const mcpSecret = (name: string) => `mcp:${name}`;

export class Profiles {
  constructor(
    private readonly store: Store,
    private readonly vault: Vault,
    private readonly clock: Clock = Date.now,
  ) {}

  async profile(id: string, reader: Queryable = this.store.db) {
    return assertFound(await findProfile(reader, id), 'Profile');
  }

  async profiles() {
    return listProfiles(this.store.db);
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

      await insertProfile(tx, stored);
      await insertRevision(tx, stored);

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
    tx: Queryable,
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
  private async validateReferences(profile: Profile, reader: Queryable) {
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

    const fromEnvironment = (Object.keys(providerCatalog) as ProviderKind[]).some(
      (kind) => environmentProvider(profile.id, kind)?.id === providerId,
    );

    if (fromEnvironment) {
      return;
    }

    const [live] = await reader
      .select({ id: providers.id })
      .from(providers)
      .where(
        and(
          eq(providers.id, providerId),
          eq(providers.profileId, profile.id),
          isNull(providers.revokedAt),
        ),
      )
      .limit(1);

    if (!live) {
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

      await updateProfileRow(tx, profile);
      await insertRevision(tx, profile);

      await recordEvent(tx, this.clock, id, 'profile.updated', {
        profileId: id,
        version: profile.version,
      });

      return profile;
    });
  }

  async revisions(id: string) {
    await this.profile(id);

    return listRevisions(this.store.db, id);
  }
}
