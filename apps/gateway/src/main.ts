import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { createApp } from './app.js';
import { GenericChannel } from './channels/generic.js';
import { ChannelRegistry } from './channels/registry.js';
import { TelegramChannel } from './channels/telegram.js';
import { WhatsAppChannel } from './channels/whatsapp/adapter.js';
import { WhatsAppConnections } from './channels/whatsapp/connections.js';
import { createWhatsAppDeviceFactory } from './channels/whatsapp/driver.js';
import { Gateway } from './gateway.js';
import { PostgresStore } from './postgres.js';
import { RunQueue } from './queue.js';
import { AgentRuntime } from './runtime.js';
import { SecretBox } from './security/crypto.js';
import { createSafeFetch } from './security/outbound.js';
import { Channels } from './services/channels.js';
import { Coordination } from './services/coordination.js';
import { Credentials } from './services/credentials.js';
import { type StartupStage, startupFailure } from './startup.js';

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    ELOS_ACTIVE_KEY_ID: z.string().min(1),
    ELOS_MASTER_KEYS: z.string().min(1),
    ELOS_ALLOW_PRIVATE_ORIGINS: z.string().default(''),
    ELOS_API_TOKEN: z.string().min(32),
    ELOS_WHATSAPP_CHROMIUM: z.string().min(1).optional(),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4310),
    ELOS_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error(
    'Elos configuration is incomplete:',
    config.error.issues.map((i) => i.path.join('.')).join(', '),
  );

  process.exit(1);
}

const store = new PostgresStore(config.data.DATABASE_URL);
const gateway = new Gateway(store);
let box: SecretBox;

try {
  const keys = z
    .record(z.string(), z.string().regex(/^[A-Za-z0-9+/]{43}=$/))
    .parse(JSON.parse(config.data.ELOS_MASTER_KEYS));

  box = new SecretBox({
    activeKeyId: config.data.ELOS_ACTIVE_KEY_ID,
    keys: Object.fromEntries(
      Object.entries(keys).map(([id, key]) => [id, Buffer.from(key, 'base64')]),
    ),
  });
} catch {
  console.error('Invalid encryption keyring. Configure ELOS_MASTER_KEYS and ELOS_ACTIVE_KEY_ID.');
  process.exit(1);
}

const credentials = new Credentials(gateway, box);

const outbound = createSafeFetch({
  allowPrivateOrigins: config.data.ELOS_ALLOW_PRIVATE_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
});

const coordination = new Coordination(gateway);
const whatsapp = new WhatsAppConnections(
  gateway,
  box,
  createWhatsAppDeviceFactory(config.data.ELOS_WHATSAPP_CHROMIUM),
);
const channelRegistry = new ChannelRegistry([
  new GenericChannel(),
  new TelegramChannel(),
  new WhatsAppChannel(whatsapp),
]);
const channels = new Channels(gateway, credentials, outbound.fetch, channelRegistry);

const runtime = new AgentRuntime(gateway, undefined, {
  credentials,
  outbound,
  storeArtifact: (run, toolName, output) => coordination.storeArtifact(run, toolName, output),
});

const queue =
  config.data.ELOS_ROLE !== 'api'
    ? new RunQueue(new PgBoss(config.data.DATABASE_URL), gateway, runtime)
    : undefined;

const app =
  config.data.ELOS_ROLE !== 'worker'
    ? createApp({
        gateway,
        credentials,
        channels,
        whatsapp,
        token: config.data.ELOS_API_TOKEN,
        onCancel: (id) => runtime.cancel(id),
      })
    : undefined;

let stopping = false;

async function shutdown() {
  if (stopping) {
    return;
  }

  stopping = true;
  // End long-lived event streams before waiting for HTTP shutdown.
  app?.server.closeAllConnections();
  await app?.close();
  await queue?.stop();
  await channels.stop();
  await whatsapp.stop();
  await outbound.close();
  await store.close();
}

process.once('SIGINT', () => {
  void shutdown();
});

process.once('SIGTERM', () => {
  void shutdown();
});

let startupStage: StartupStage = 'database';

try {
  await store.migrate();
  startupStage = 'queue';
  await queue?.start();

  if (config.data.ELOS_ROLE !== 'api') {
    whatsapp.start((id, input, generation) => channels.receiveLinked(id, input, generation));
    channels.start();
  }

  if (app) {
    startupStage = 'http';
    await app.listen({ host: config.data.HOST, port: config.data.PORT });
  } else {
    console.info('Elos worker started');
  }
} catch (error) {
  console.error(startupFailure(startupStage, error));
  await shutdown().catch(() => {});
  process.exitCode = 1;
}
