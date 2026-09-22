import { createHash, randomUUID } from 'node:crypto';
import {
  artifactQuerySchema,
  type artifactSchema,
  leaseInputSchema,
  type leaseSchema,
  mailInputSchema,
  type mailSchema,
  pageQuerySchema,
  type Run,
} from '@elos/contracts';
import { z } from 'zod';
import { assertFound, GatewayError } from '../core/errors.js';
import type { Gateway } from '../gateway.js';

export type ArtifactRecord = z.infer<typeof artifactSchema>;

export type LeaseRecord = z.infer<typeof leaseSchema>;

export type MailRecord = z.infer<typeof mailSchema>;

const releaseSchema = leaseInputSchema
  .omit({ ttlSeconds: true })
  .extend({ fence: z.number().int().positive() });

export class Coordination {
  constructor(
    private readonly gateway: Gateway,
    private readonly clock = Date.now,
  ) {}

  async history(profileId: string, sessionId: string | undefined, input: unknown) {
    const query = pageQuerySchema.parse(input);

    if (sessionId) {
      await this.gateway.session(profileId, sessionId);
    } else {
      await this.gateway.profile(profileId);
    }

    // A cursor is a record reference, so validate ownership before using it for pagination.
    if (query.before) {
      const cursor = await this.gateway.store.get('message', query.before);

      assertFound(
        cursor?.profileId === profileId && (!sessionId || cursor.sessionId === sessionId)
          ? cursor
          : null,
        'History cursor',
      );
    }

    const items = await this.gateway.store.list('message', {
      profileId,
      ...(sessionId ? { where: { sessionId } } : {}),
      before: query.before,
      search: query.q,
      limit: query.limit + 1,
      descending: true,
    });

    const more = items.length > query.limit;
    const page = items.slice(0, query.limit);

    return { items: page, nextCursor: more ? (page.at(-1)?.id ?? null) : null };
  }

  async storeArtifact(run: Run, toolName: string, output: unknown) {
    const content = JSON.stringify(output) ?? 'null';
    const bytes = Buffer.byteLength(content);

    if (bytes > 1000000) {
      throw new GatewayError(413, 'Tool result exceeds the artifact size limit');
    }

    const record: ArtifactRecord = {
      id: randomUUID(),
      profileId: run.profileId,
      runId: run.id,
      toolName,
      content,
      bytes,
      createdAt: new Date(this.clock()).toISOString(),
    };

    await this.gateway.store.transaction(run.profileId, async (tx) => {
      await this.gateway.run(run.profileId, run.id, tx);
      await tx.put('artifact', record.id, run.profileId, record);
    });

    return { artifactId: record.id, bytes };
  }

  async artifact(profileId: string, id: string, input: unknown) {
    const { offset, limit } = artifactQuerySchema.parse(input);
    const value = await this.gateway.store.get('artifact', id);
    const record = assertFound(value?.profileId === profileId ? value : null, 'Artifact');
    const end = Math.min(offset + limit, record.content.length);

    return {
      ...record,
      content: record.content.slice(offset, end),
      nextOffset: end < record.content.length ? end : null,
    };
  }

  private leaseId(profileId: string, resource: string) {
    return `${profileId}:${createHash('sha256').update(resource).digest('hex')}`;
  }

  async acquire(profileId: string, input: unknown) {
    const { ttlSeconds, ...data } = leaseInputSchema.parse(input);

    return this.gateway.store.transaction(profileId, async (tx) => {
      await this.gateway.session(profileId, data.sessionId, tx);

      const id = this.leaseId(profileId, data.resource);
      const current = await tx.get('lease', id);

      if (current && current.expiresAt > this.clock() && current.sessionId !== data.sessionId) {
        throw new GatewayError(409, 'Resource is held by another session');
      }

      // Every acquisition gets a new fence, including renewal. External resources must honor it.
      const record: LeaseRecord = {
        ...data,
        id,
        profileId,
        fence: (current?.fence ?? 0) + 1,
        expiresAt: this.clock() + ttlSeconds * 1000,
      };

      await tx.put('lease', id, profileId, record);

      await tx.event({
        profileId,
        type: 'resource.acquired',
        data: record,
        createdAt: new Date(this.clock()).toISOString(),
      });

      return record;
    });
  }

  async release(profileId: string, input: unknown) {
    const data = releaseSchema.parse(input);

    return this.gateway.store.transaction(profileId, async (tx) => {
      const record = assertFound(
        await tx.get('lease', this.leaseId(profileId, data.resource)),
        'Resource lease',
      );

      if (
        record.sessionId !== data.sessionId ||
        record.fence !== data.fence ||
        record.expiresAt <= this.clock()
      ) {
        throw new GatewayError(409, 'Resource lease is no longer valid');
      }

      const released = { ...record, expiresAt: this.clock() };

      await tx.put('lease', record.id, profileId, released);

      return released;
    });
  }

  async send(profileId: string, input: unknown) {
    const data = mailInputSchema.parse(input);

    return this.gateway.store.transaction(profileId, async (tx) => {
      await this.gateway.session(profileId, data.fromSessionId, tx);
      await this.gateway.session(profileId, data.toSessionId, tx);

      const id = `${profileId}:${createHash('sha256')
        .update(JSON.stringify([data.fromSessionId, data.requestKey]))
        .digest('hex')}`;

      const previous = await tx.get('mail', id);

      if (previous) {
        if (previous.text !== data.text || previous.toSessionId !== data.toSessionId) {
          throw new GatewayError(409, 'Request key already used');
        }

        return previous;
      }

      const record: MailRecord = {
        ...data,
        id,
        profileId,
        createdAt: new Date(this.clock()).toISOString(),
      };

      await tx.put('mail', id, profileId, record);

      await tx.event({
        profileId,
        type: 'session.mail',
        data: { id, toSessionId: data.toSessionId, fromSessionId: data.fromSessionId },
        createdAt: record.createdAt,
      });

      return record;
    });
  }

  async inbox(profileId: string, sessionId: string) {
    await this.gateway.session(profileId, sessionId);

    return this.gateway.store.list('mail', {
      profileId,
      where: { toSessionId: sessionId },
      limit: 30,
      descending: true,
    });
  }
}
