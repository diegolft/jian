import { type Clock, nowIso } from '../core/clock.js';
import type { Reader, Store, Transaction } from '../core/store.js';
import type { EncryptedSecret, SecretBox } from './crypto.js';

export type SecretRecord = {
  id: string;
  profileId: string;
  owner: string;
  envelope: EncryptedSecret;
  createdAt: string;
  updatedAt: string;
};

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

  private key(profileId: string, owner: string) {
    return `${profileId}:${owner}`;
  }

  private aad(profileId: string, owner: string) {
    return `jian:secret:${profileId}:${owner}`;
  }

  async put(profileId: string, owner: string, secret: string, tx?: Transaction): Promise<void> {
    const write = async (transaction: Transaction) => {
      const id = this.key(profileId, owner);
      const current = await transaction.get('secret', id);
      const now = nowIso(this.clock);

      await transaction.put('secret', id, profileId, {
        id,
        profileId,
        owner,
        envelope: this.box.encrypt(secret, this.aad(profileId, owner)),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
    };

    await (tx ? write(tx) : this.store.transaction(profileId, write));
  }

  async read(profileId: string, owner: string, reader: Reader = this.store) {
    const record = await reader.get('secret', this.key(profileId, owner));

    if (!record || record.profileId !== profileId) {
      return undefined;
    }

    return this.box.decrypt(record.envelope, this.aad(profileId, owner));
  }

  async discard(profileId: string, owner: string, tx?: Transaction): Promise<void> {
    const remove = async (transaction: Transaction) =>
      transaction.remove('secret', this.key(profileId, owner), profileId);

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
