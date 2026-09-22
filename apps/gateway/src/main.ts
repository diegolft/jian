import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { AgentRuntime } from './agent/runtime.js';
import { createApp } from './app.js';
import { GenericChannel } from './channels/generic.js';
import { ChannelRegistry } from './channels/registry.js';
import { Channels } from './channels/service.js';
import { TelegramChannel } from './channels/telegram.js';
import { WhatsAppChannel } from './channels/whatsapp/adapter.js';
import { WhatsAppConnections } from './channels/whatsapp/connections.js';
import { createWhatsAppDeviceFactory } from './channels/whatsapp/driver.js';
import { Coordination } from './coordination/service.js';
import { CodexLogin } from './providers/codex/login.js';
import { RunQueue } from './runs/queue.js';
import { Credentials } from './security/credentials.js';
import { SecretBox } from './security/crypto.js';
import { createSafeFetch } from './security/outbound.js';
import { buildServices } from './services.js';
import { type StartupStage, startupFailure } from './startup.js';
import { PostgresStore } from './storage/postgres.js';

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    JIAN_ACTIVE_KEY_ID: z.string().min(1),
    JIAN_MASTER_KEYS: z.string().min(1),
    JIAN_ALLOW_PRIVATE_ORIGINS: z.string().default(''),
    JIAN_API_TOKEN: z.string().min(32),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4310),
    JIAN_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error(
    'Jian configuration is incomplete:',
    config.error.issues.map((i) => i.path.join('.')).join(', '),
  );

  process.exit(1);
}

const store = new PostgresStore(config.data.DATABASE_URL);
// The store rides along: several consumers read records no single area owns.
const services = { ...buildServices({ store }), store };
let box: SecretBox;

try {
  const keys = z
    .record(z.string(), z.string().regex(/^[A-Za-z0-9+/]{43}=$/))
    .parse(JSON.parse(config.data.JIAN_MASTER_KEYS));

  box = new SecretBox({
    activeKeyId: config.data.JIAN_ACTIVE_KEY_ID,
    keys: Object.fromEntries(
      Object.entries(keys).map(([id, key]) => [id, Buffer.from(key, 'base64')]),
    ),
  });
} catch {
  console.error('Invalid encryption keyring. Configure JIAN_MASTER_KEYS and JIAN_ACTIVE_KEY_ID.');
  process.exit(1);
}

const credentials = new Credentials(services, box);
const codexLogin = new CodexLogin(services, credentials);

const outbound = createSafeFetch({
  allowPrivateOrigins: config.data.JIAN_ALLOW_PRIVATE_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
});

const coordination = new Coordination(services);
const whatsapp = new WhatsAppConnections(store, box, createWhatsAppDeviceFactory());
const channelRegistry = new ChannelRegistry([
  new GenericChannel(),
  new TelegramChannel(),
  new WhatsAppChannel(whatsapp),
]);
const channels = new Channels(services, credentials, outbound.fetch, channelRegistry);

const runtime = new AgentRuntime(services, undefined, {
  credentials,
  codexLogin,
  outbound,
  storeArtifact: (run, toolName, output) => coordination.storeArtifact(run, toolName, output),
});

const queue =
  config.data.JIAN_ROLE !== 'api'
    ? new RunQueue(new PgBoss(config.data.DATABASE_URL), services, runtime)
    : undefined;

const app =
  config.data.JIAN_ROLE !== 'worker'
    ? createApp({
        ...services,
        credentials,
        codexLogin,
        channels,
        whatsapp,
        token: config.data.JIAN_API_TOKEN,
        onCancel: (id) => runtime.cancel(id),
      })
    : undefined;

let stopping = false;

async function shutdown() {
  if (stopping) {
    return;
  }

  stopping = true;
  codexLogin.stop();
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

  if (config.data.JIAN_ROLE !== 'api') {
    whatsapp.start((id, input, generation) => channels.receiveLinked(id, input, generation));
    channels.start();
  }

  if (app) {
    startupStage = 'http';
    await app.listen({ host: config.data.HOST, port: config.data.PORT });
  } else {
    console.info('Jian worker started');
  }
} catch (error) {
  console.error(startupFailure(startupStage, error));
  await shutdown().catch(() => {});
  process.exitCode = 1;
}
