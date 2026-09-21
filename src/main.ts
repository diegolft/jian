import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { createApp } from './app.js';
import { Gateway } from './gateway.js';
import { PostgresStore } from './postgres.js';
import { RunQueue } from './queue.js';
import { AgentRuntime } from './runtime.js';

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    ELOS_API_TOKEN: z.string().min(32),
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
const runtime = new AgentRuntime(gateway);
const queue =
  config.data.ELOS_ROLE !== 'api'
    ? new RunQueue(new PgBoss(config.data.DATABASE_URL), gateway, runtime)
    : undefined;
const app =
  config.data.ELOS_ROLE !== 'worker'
    ? createApp({
        gateway,
        token: config.data.ELOS_API_TOKEN,
        onCancel: (id) => runtime.cancel(id),
      })
    : undefined;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // End long-lived event streams before waiting for HTTP shutdown.
  app?.server.closeAllConnections();
  await app?.close();
  await queue?.stop();
  await store.close();
}
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
try {
  await store.migrate();
  await queue?.start();
  if (app) await app.listen({ host: config.data.HOST, port: config.data.PORT });
  else console.info('Elos worker started');
} catch {
  console.error('Elos startup failed. Check database connectivity and configuration.');
  await shutdown().catch(() => {});
  process.exitCode = 1;
}
