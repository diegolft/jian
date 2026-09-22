import { z } from 'zod';
import {
  channelConnectionSchema,
  channelInputSchema,
  channelQrSchema,
  channelSchema,
  deliverySchema,
  ingressResultSchema,
  ingressSchema,
  telegramUpdateSchema,
} from './channels.js';
import {
  artifactPageSchema,
  artifactQuerySchema,
  leaseInputSchema,
  leaseSchema,
  mailInputSchema,
  mailSchema,
  pageQuerySchema,
} from './coordination.js';
import {
  memorySchema,
  profilePatchSchema,
  profileSchema,
  sessionSchema,
  submitSchema,
} from './profile.js';
import {
  checkpointSchema,
  continuationSchema,
  eventSchema,
  memoryRecordSchema,
  messageRecordSchema,
  profileRecordSchema,
  revisionRecordSchema,
  runRecordSchema,
  sessionRecordSchema,
} from './records.js';
import {
  credentialInputSchema,
  credentialMetadataSchema,
  keyInputSchema,
  keyMetadataSchema,
  type Scope,
} from './security.js';

export type Operation = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  operationId: string;
  scope: Scope | 'admin' | 'public' | 'webhook';
  body?: z.ZodType;
  query?: z.ZodType;
  response: z.ZodType;
  status?: number;
  stream?: boolean;
};

const profile = '/v1/profiles/:profileId';
const session = `${profile}/sessions/:sessionId`;

export const cursorSchema = z.strictObject({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});

export const operations: Operation[] = [
  {
    method: 'GET',
    path: '/openapi.json',
    operationId: 'getOpenAPI',
    scope: 'admin',
    response: z.record(z.string(), z.unknown()),
  },
  {
    method: 'GET',
    path: `${profile}/runs/:runId/checkpoints`,
    operationId: 'listRunCheckpoints',
    scope: 'read',
    response: z.array(checkpointSchema),
  },
  {
    method: 'POST',
    path: `${profile}/runs/:runId/continue`,
    operationId: 'continueRun',
    scope: 'chat',
    body: continuationSchema,
    response: runRecordSchema,
    status: 202,
  },
  {
    method: 'POST',
    path: `${profile}/channels`,
    operationId: 'createChannel',
    scope: 'admin',
    body: channelInputSchema,
    response: channelSchema.extend({ webhookToken: z.string() }),
    status: 201,
  },
  {
    method: 'GET',
    path: `${profile}/channels`,
    operationId: 'listChannels',
    scope: 'admin',
    response: z.array(channelSchema),
  },
  {
    method: 'DELETE',
    path: `${profile}/channels/:channelId`,
    operationId: 'revokeChannel',
    scope: 'admin',
    response: channelSchema,
  },
  {
    method: 'GET',
    path: `${profile}/deliveries`,
    operationId: 'listDeliveries',
    scope: 'read',
    response: z.array(deliverySchema),
  },
  {
    method: 'POST',
    path: `${profile}/channels/:channelId/connect`,
    operationId: 'connectChannel',
    scope: 'admin',
    response: channelConnectionSchema,
    status: 202,
  },
  {
    method: 'GET',
    path: `${profile}/channels/:channelId/connection`,
    operationId: 'getChannelConnection',
    scope: 'admin',
    response: channelConnectionSchema,
  },
  {
    method: 'GET',
    path: `${profile}/channels/:channelId/qr`,
    operationId: 'getChannelQr',
    scope: 'admin',
    response: channelQrSchema,
  },
  {
    method: 'POST',
    path: `${profile}/channels/:channelId/disconnect`,
    operationId: 'disconnectChannel',
    scope: 'admin',
    response: channelConnectionSchema,
    status: 202,
  },
  {
    method: 'POST',
    path: '/v1/ingress/:channelId',
    operationId: 'channelIngress',
    scope: 'webhook',
    body: ingressSchema,
    response: ingressResultSchema,
    status: 202,
  },
  {
    method: 'POST',
    path: '/v1/telegram/:channelId',
    operationId: 'telegramIngress',
    scope: 'webhook',
    body: telegramUpdateSchema,
    response: ingressResultSchema,
  },
  {
    method: 'GET',
    path: `${profile}/sessions/:sessionId/history`,
    operationId: 'getHistory',
    scope: 'read',
    query: pageQuerySchema,
    response: z.strictObject({
      items: z.array(messageRecordSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  {
    method: 'GET',
    path: `${profile}/history`,
    operationId: 'searchHistory',
    scope: 'read',
    query: pageQuerySchema,
    response: z.strictObject({
      items: z.array(messageRecordSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  {
    method: 'GET',
    path: `${profile}/artifacts/:artifactId`,
    operationId: 'getArtifact',
    scope: 'read',
    query: artifactQuerySchema,
    response: artifactPageSchema,
  },
  {
    method: 'POST',
    path: `${profile}/leases`,
    operationId: 'acquireResource',
    scope: 'chat',
    body: leaseInputSchema,
    response: leaseSchema,
  },
  {
    method: 'POST',
    path: `${profile}/leases/release`,
    operationId: 'releaseResource',
    scope: 'chat',
    body: leaseInputSchema
      .omit({ ttlSeconds: true })
      .extend({ fence: z.number().int().positive() }),
    response: leaseSchema,
  },
  {
    method: 'POST',
    path: `${profile}/mail`,
    operationId: 'sendSessionMail',
    scope: 'chat',
    body: mailInputSchema,
    response: mailSchema,
  },
  {
    method: 'GET',
    path: `${session}/mail`,
    operationId: 'getSessionInbox',
    scope: 'read',
    response: z.array(mailSchema),
  },

  {
    method: 'GET',
    path: '/health',
    operationId: 'health',
    scope: 'public',
    response: z.strictObject({ status: z.literal('ok'), service: z.literal('elos') }),
  },
  {
    method: 'GET',
    path: '/v1/profiles',
    operationId: 'listProfiles',
    scope: 'admin',
    response: z.array(profileRecordSchema),
  },
  {
    method: 'POST',
    path: '/v1/profiles',
    operationId: 'createProfile',
    scope: 'admin',
    body: profileSchema,
    response: profileRecordSchema,
    status: 201,
  },
  {
    method: 'GET',
    path: profile,
    operationId: 'getProfile',
    scope: 'read',
    response: profileRecordSchema,
  },
  {
    method: 'PATCH',
    path: profile,
    operationId: 'updateProfile',
    scope: 'profile:write',
    body: profilePatchSchema,
    response: profileRecordSchema,
  },
  {
    method: 'GET',
    path: `${profile}/revisions`,
    operationId: 'listRevisions',
    scope: 'read',
    response: z.array(revisionRecordSchema),
  },
  {
    method: 'GET',
    path: `${profile}/sessions`,
    operationId: 'listSessions',
    scope: 'read',
    response: z.array(sessionRecordSchema),
  },
  {
    method: 'POST',
    path: `${profile}/sessions`,
    operationId: 'createSession',
    scope: 'chat',
    body: sessionSchema,
    response: sessionRecordSchema,
    status: 201,
  },
  {
    method: 'GET',
    path: `${session}/messages`,
    operationId: 'listMessages',
    scope: 'read',
    response: z.array(messageRecordSchema),
  },
  {
    method: 'POST',
    path: `${session}/messages`,
    operationId: 'submitMessage',
    scope: 'chat',
    body: submitSchema,
    response: runRecordSchema,
    status: 202,
  },
  {
    method: 'GET',
    path: `${profile}/memories`,
    operationId: 'listMemories',
    scope: 'read',
    response: z.array(memoryRecordSchema),
  },
  {
    method: 'PUT',
    path: `${profile}/memories`,
    operationId: 'writeMemory',
    scope: 'memory:write',
    body: memorySchema,
    response: memoryRecordSchema,
  },
  {
    method: 'GET',
    path: `${profile}/activities`,
    operationId: 'listActivities',
    scope: 'read',
    response: z.array(runRecordSchema),
  },
  {
    method: 'GET',
    path: `${profile}/runs/:runId`,
    operationId: 'getRun',
    scope: 'read',
    response: runRecordSchema,
  },
  {
    method: 'POST',
    path: `${profile}/runs/:runId/cancel`,
    operationId: 'cancelRun',
    scope: 'chat',
    response: runRecordSchema,
  },
  {
    method: 'GET',
    path: `${profile}/events`,
    operationId: 'listEvents',
    scope: 'read',
    query: cursorSchema,
    response: z.array(eventSchema),
  },
  {
    method: 'GET',
    path: `${profile}/events/stream`,
    operationId: 'streamEvents',
    scope: 'read',
    query: cursorSchema,
    response: z.string(),
    stream: true,
  },
  {
    method: 'POST',
    path: `${profile}/credentials`,
    operationId: 'createCredential',
    scope: 'admin',
    body: credentialInputSchema,
    response: credentialMetadataSchema,
    status: 201,
  },
  {
    method: 'GET',
    path: `${profile}/credentials`,
    operationId: 'listCredentials',
    scope: 'admin',
    response: z.array(credentialMetadataSchema),
  },
  {
    method: 'DELETE',
    path: `${profile}/credentials/:credentialId`,
    operationId: 'revokeCredential',
    scope: 'admin',
    response: credentialMetadataSchema,
  },
  {
    method: 'POST',
    path: `${profile}/credentials/:credentialId/rotate`,
    operationId: 'rotateCredential',
    scope: 'admin',
    response: credentialMetadataSchema,
  },
  {
    method: 'POST',
    path: `${profile}/keys`,
    operationId: 'createAccessKey',
    scope: 'admin',
    body: keyInputSchema,
    response: keyMetadataSchema.extend({
      token: z.string().meta({ description: 'Returned only when created.' }),
    }),
    status: 201,
  },
  {
    method: 'GET',
    path: `${profile}/keys`,
    operationId: 'listAccessKeys',
    scope: 'admin',
    response: z.array(keyMetadataSchema),
  },
  {
    method: 'DELETE',
    path: `${profile}/keys/:keyId`,
    operationId: 'revokeAccessKey',
    scope: 'admin',
    response: keyMetadataSchema,
  },
];

export function jsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input') {
  const { $schema: _dialect, ...result } = z.toJSONSchema(schema, { target: 'draft-7', io });

  return result;
}

export const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
};

export function operationSchema(operation: Operation) {
  const names = [...operation.path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1] as string);

  return {
    operationId: operation.operationId,
    ...(operation.body ? { body: jsonSchema(operation.body) } : {}),
    ...(operation.query ? { querystring: jsonSchema(operation.query) } : {}),
    ...(names.length
      ? {
          params: jsonSchema(
            z.strictObject(Object.fromEntries(names.map((name) => [name, z.uuid()]))),
          ),
        }
      : {}),
    response: {
      [operation.status ?? 200]: jsonSchema(operation.response, 'output'),
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 413, 429, 500, 503].map((code) => [code, errorSchema]),
      ),
    },
  };
}

type RouteSchema = ReturnType<typeof operationSchema>;

function securityRequirements(operation: Operation) {
  if (operation.scope === 'public') {
    return [];
  }

  if (operation.scope === 'webhook') {
    const scheme =
      operation.operationId === 'telegramIngress' ? 'telegramWebhook' : 'channelWebhook';

    return [{ [scheme]: [] }];
  }

  return [{ bearerAuth: [] }];
}

function openAPIParameters(schema: RouteSchema) {
  const params = schema.params?.properties ?? {};
  const query = schema.querystring?.properties ?? {};

  return [
    ...Object.entries(params).map(([name, value]) => ({
      name,
      in: 'path',
      required: true,
      schema: value,
    })),
    ...Object.entries(query).map(([name, value]) => ({
      name,
      in: 'query',
      required: false,
      schema: value,
    })),
  ];
}

function openAPIResponses(operation: Operation, schema: RouteSchema) {
  return Object.fromEntries(
    Object.entries(schema.response).map(([code, value]) => {
      const contentType =
        operation.stream && code === '200' ? 'text/event-stream' : 'application/json';

      return [
        code,
        {
          description: Number(code) < 400 ? 'Success' : 'Error',
          content: { [contentType]: { schema: value } },
        },
      ];
    }),
  );
}

function openAPIOperation(operation: Operation) {
  const schema = operationSchema(operation);

  return {
    operationId: operation.operationId,
    security: securityRequirements(operation),
    description: `Required permission: ${operation.scope}.`,
    parameters: openAPIParameters(schema),
    ...(schema.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema.body } },
          },
        }
      : {}),
    responses: openAPIResponses(operation, schema),
  };
}

/** Runtime validation and client generation share the same operation definitions. */
export function createOpenAPI() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of operations) {
    const path = operation.path.replace(/:([A-Za-z]+)/g, '{$1}');

    paths[path] ??= {};
    paths[path][operation.method.toLowerCase()] = openAPIOperation(operation);
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Elos Gateway', version: '0.2.0' },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        telegramWebhook: { type: 'apiKey', in: 'header', name: 'X-Telegram-Bot-Api-Secret-Token' },
        channelWebhook: { type: 'apiKey', in: 'header', name: 'X-Elos-Channel-Token' },
      },
    },
  };
}
