import { and, eq } from 'drizzle-orm';
import type { Clock } from '../core/clock.js';
import type { Queryable, Store } from '../storage/database.js';
import { secrets } from '../storage/schema.js';
import type { EncryptedSecret, SecretBox } from './crypto.js';

/**
 * Encrypted storage for the secrets typed elsewhere in the panel: a provider key, an MCP
 * bearer token, a channel bot token. It has no surface of its own — a secret is addressed by
 * the thing that owns it (`provider:<id>`, `mcp:<name>`, `channel:<id>`), so removing that
 * thing removes the secret, and there is no identifier for an owner to carry around.
 *
 * The associated data binds a ciphertext to its profile and owner, so an envelope moved
 * between records or profiles fails to decrypt instead of leaking across the isolation line.
 */
export class Vault {
  constructor(
    private readonly store: Store,
    private readonly box: SecretBox,
    private readonly clock: Clock = Date.now,
  ) {}

  private aad(profileId: string, owner: string) {
    return `jian:secret:${profileId}:${owner}`;
  }

  async put(profileId: string, owner: string, secret: string, tx?: Queryable): Promise<void> {
    const write = async (transaction: Queryable) => {
      const envelope = this.box.encrypt(secret, this.aad(profileId, owner));
      const now = new Date(this.clock());

      await transaction
        .insert(secrets)
        .values({ profileId, name: owner, envelope, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [secrets.profileId, secrets.name],
          set: { envelope, updatedAt: now },
        });
    };

    await (tx ? write(tx) : this.store.transaction(profileId, write));
  }

  async read(profileId: string, owner: string, reader: Queryable = this.store.db) {
    const [row] = await reader
      .select({ envelope: secrets.envelope })
      .from(secrets)
      .where(and(eq(secrets.profileId, profileId), eq(secrets.name, owner)))
      .limit(1);

    if (!row) {
      return undefined;
    }

    return this.box.decrypt(row.envelope as EncryptedSecret, this.aad(profileId, owner));
  }

  async discard(profileId: string, owner: string, tx?: Queryable): Promise<void> {
    const remove = async (transaction: Queryable) => {
      await transaction
        .delete(secrets)
        .where(and(eq(secrets.profileId, profileId), eq(secrets.name, owner)));
    };

    await (tx ? remove(tx) : this.store.transaction(profileId, remove));
  }

  /**
   * Reads, transforms and rewrites a secret under the profile lock, so a refreshed OAuth token
   * cannot be overwritten by a concurrent refresh that started from the older value.
   */
  async refresh(
    profileId: string,
    owner: string,
    transform: (secret: string) => Promise<string>,
  ): Promise<string> {
    return this.store.transaction(profileId, async (tx) => {
      const current = await this.read(profileId, owner, tx);

      if (current === undefined) {
        throw new Error('Secret is not configured');
      }

      const next = await transform(current);

      if (next !== current) {
        await this.put(profileId, owner, next, tx);
      }

      return next;
    });
  }
}
