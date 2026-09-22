import { randomUUID } from 'node:crypto';
import {
  credentialInputSchema,
  type credentialMetadataSchema,
  keyInputSchema,
  type keyMetadataSchema,
  type Scope,
} from '@elos/contracts';
import type { z } from 'zod';
import { assertFound, GatewayError } from '../core/errors.js';
import type { Store } from '../core/store.js';
import type { Profiles } from '../profiles/service.js';
import type { EncryptedSecret, SecretBox } from '../security/crypto.js';
import { hashToken, issueToken } from '../security/tokens.js';

type CredentialMetadata = z.infer<typeof credentialMetadataSchema>;

export type CredentialRecord = Omit<CredentialMetadata, 'keyId'> & { envelope: EncryptedSecret };

export type AccessKeyRecord = z.infer<typeof keyMetadataSchema> & { hash: string };

/** Only metadata leaves this service. AAD prevents copying a secret between profiles or purposes. */
export class Credentials {
  constructor(
    private readonly services: { profiles: Profiles; store: Store },
    private readonly box: SecretBox,
  ) {}

  private metadata(record: CredentialRecord): CredentialMetadata {
    const { envelope, ...metadata } = record;

    return { ...metadata, keyId: envelope.keyId };
  }

  private aad(record: Pick<CredentialRecord, 'id' | 'profileId' | 'kind'>) {
    return `elos:credential:${record.profileId}:${record.kind}:${record.id}`;
  }

  async create(profileId: string, input: unknown) {
    const { secret, ...data } = credentialInputSchema.parse(input);
    const now = new Date().toISOString();

    const metadata = {
      ...data,
      id: randomUUID(),
      profileId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const record: CredentialRecord = {
      ...metadata,
      envelope: this.box.encrypt(secret, this.aad(metadata)),
    };

    await this.services.store.transaction(profileId, async (tx) => {
      await this.services.profiles.profile(profileId, tx);
      await tx.put('credential', record.id, profileId, record);

      await tx.event({
        profileId,
        type: 'credential.created',
        data: { id: record.id, kind: record.kind },
        createdAt: now,
      });
    });

    return this.metadata(record);
  }

  async list(profileId: string) {
    await this.services.profiles.profile(profileId);

    return (await this.services.store.list('credential', { profileId })).map((record) =>
      this.metadata(record),
    );
  }

  async resolve(profileId: string, id: string, kind: CredentialRecord['kind']) {
    const record = await this.services.store.get('credential', id);

    if (!record || record.profileId !== profileId || record.kind !== kind || record.revokedAt) {
      throw new GatewayError(403, 'Credential unavailable');
    }

    return this.box.decrypt(record.envelope, this.aad(record));
  }

  async transformSecret(
    profileId: string,
    id: string,
    transform: (secret: string) => Promise<string>,
  ) {
    return this.services.store.transaction(profileId, async (tx) => {
      const record = await tx.get('credential', id);
      if (
        !record ||
        record.profileId !== profileId ||
        record.kind !== 'provider' ||
        record.revokedAt
      ) {
        throw new GatewayError(403, 'Credential unavailable');
      }
      const current = this.box.decrypt(record.envelope, this.aad(record));
      const next = await transform(current);
      if (next !== current) {
        await tx.put('credential', id, profileId, {
          ...record,
          envelope: this.box.encrypt(next, this.aad(record)),
          version: record.version + 1,
          updatedAt: new Date().toISOString(),
        });
      }
      return next;
    });
  }

  private async change(profileId: string, id: string, rotate: boolean) {
    return this.services.store.transaction(profileId, async (tx) => {
      const value = await tx.get('credential', id);
      const record = assertFound(value?.profileId === profileId ? value : null, 'Credential');
      const now = new Date().toISOString();

      const changed = {
        ...record,
        version: record.version + 1,
        updatedAt: now,
        ...(rotate
          ? { envelope: this.box.rotate(record.envelope, this.aad(record)) }
          : { revokedAt: now }),
      };

      await tx.put('credential', id, profileId, changed);

      await tx.event({
        profileId,
        type: rotate ? 'credential.rotated' : 'credential.revoked',
        data: { id },
        createdAt: now,
      });

      return this.metadata(changed);
    });
  }

  revoke(profileId: string, id: string) {
    return this.change(profileId, id, false);
  }

  rotate(profileId: string, id: string) {
    return this.change(profileId, id, true);
  }

  async issueKey(profileId: string, input: unknown) {
    const data = keyInputSchema.parse(input);

    if (Date.parse(data.expiresAt) <= Date.now()) {
      throw new GatewayError(400, 'Key expiry must be in the future');
    }

    const issued = issueToken();
    // Authentication queries an indexed hash; plaintext tokens are never persisted.
    const id = randomUUID();

    const record: AccessKeyRecord = {
      ...data,
      id,
      profileId,
      hash: issued.hash,
      prefix: issued.prefix,
      createdAt: new Date().toISOString(),
    };

    await this.services.store.transaction(profileId, async (tx) => {
      await this.services.profiles.profile(profileId, tx);
      await tx.put('accessKey', id, profileId, record);

      await tx.event({
        profileId,
        type: 'access-key.created',
        data: { id, scopes: data.scopes },
        createdAt: record.createdAt,
      });
    });

    const { hash: _hash, ...metadata } = record;

    return { ...metadata, token: issued.token };
  }

  async keys(profileId: string) {
    await this.services.profiles.profile(profileId);

    return (await this.services.store.list('accessKey', { profileId })).map(
      ({ hash: _hash, ...metadata }) => metadata,
    );
  }

  async revokeKey(profileId: string, id: string) {
    return this.services.store.transaction(profileId, async (tx) => {
      const value = await tx.get('accessKey', id);
      const record = assertFound(value?.profileId === profileId ? value : null, 'Access key');
      const changed = { ...record, revokedAt: new Date().toISOString() };

      await tx.put('accessKey', id, profileId, changed);

      await tx.event({
        profileId,
        type: 'access-key.revoked',
        data: { id },
        createdAt: changed.revokedAt,
      });

      const { hash: _hash, ...metadata } = changed;

      return metadata;
    });
  }

  async authorize(token: string, profileId: string | undefined, scope: Scope | 'admin') {
    if (!profileId || scope === 'admin') {
      throw new GatewayError(403, 'Insufficient permission');
    }

    let hash: string;

    try {
      hash = hashToken(token);
    } catch {
      throw new GatewayError(401, 'Unauthorized');
    }

    const [key] = await this.services.store.list('accessKey', {
      profileId,
      where: { hash },
      limit: 1,
    });

    if (!key || key.revokedAt || Date.parse(key.expiresAt) <= Date.now()) {
      throw new GatewayError(401, 'Unauthorized');
    }

    if (!key.scopes.includes(scope)) {
      throw new GatewayError(403, 'Insufficient permission');
    }
  }
}
