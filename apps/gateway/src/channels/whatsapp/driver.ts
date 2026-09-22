import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WhatsApp from 'whatsapp-web.js';
import { MAX_DEVICE_SESSION_BYTES } from './connections.js';
import type { DeviceFactory } from './types.js';
import { DEVICE_SEND_TIMEOUT_MS } from './types.js';

/** Upstream exposes this method at runtime, but omits it from its RemoteAuth declaration. */
type SessionBackup = { storeRemoteSession(options?: { emit: boolean }): Promise<void> };

export function createWhatsAppDeviceFactory(executablePath?: string): DeviceFactory {
  return async (id, store, callbacks) => {
    if (!executablePath) {
      throw new Error('ELOS_WHATSAPP_CHROMIUM is required');
    }

    // Chromium needs plaintext while running. Keep its working files private and ephemeral;
    // only encrypted session archives are persisted by the gateway's store.
    const directory = await mkdtemp(join(tmpdir(), 'elos-whatsapp-'));
    await chmod(directory, 0o700);
    const sessionName = `RemoteAuth-${id}`;
    const archive = join(directory, `${sessionName}.zip`);
    let closed = false;
    let backupTimer: ReturnType<typeof setTimeout> | undefined;
    let backup: Promise<void> = Promise.resolve();
    let initialization: Promise<void> | undefined;
    let stopping: Promise<void> | undefined;

    const checkSession = (session: string, path?: string) => {
      if (session !== sessionName || (path !== undefined && path !== archive)) {
        throw new Error('Device session path mismatch');
      }
    };

    const auth = new WhatsApp.RemoteAuth({
      clientId: id,
      dataPath: directory,
      backupSyncIntervalMs: 60_000,
      store: {
        sessionExists: async ({ session }) => {
          checkSession(session);
          return !!(await store.load());
        },
        save: async ({ session }) => {
          checkSession(session);

          if ((await stat(archive)).size > MAX_DEVICE_SESSION_BYTES) {
            throw new Error('Device session size limit exceeded');
          }

          await store.save(await readFile(archive));
        },
        extract: async ({ session, path }) => {
          checkSession(session, path);
          const data = await store.load();

          if (!data) {
            throw new Error('Device session missing');
          }

          await writeFile(path, data, { mode: 0o600 });
        },
        delete: async ({ session }) => {
          checkSession(session);
          await store.clear();
        },
      },
    });

    // Own the backup timer so a late authentication callback cannot restart it after shutdown.
    auth.afterAuthReady = async () => {};

    const client = new WhatsApp.Client({
      authStrategy: auth,
      deviceName: 'Elos Gateway',
      browserName: 'Chrome',
      qrMaxRetries: 5,
      takeoverOnConflict: false,
      webVersionCache: { type: 'none' },
      puppeteer: {
        executablePath,
        headless: true,
        args: ['--disable-dev-shm-usage'],
        timeout: 30_000,
      },
    });

    const stop = (logout: boolean): Promise<void> => {
      if (stopping) return stopping;
      closed = true;
      clearTimeout(backupTimer);
      client.removeAllListeners();

      stopping = (async () => {
        if (logout) {
          await client.logout().catch(() => {});
        }

        await client.destroy().catch(() => {});
        // initialize may have been awaiting Chromium launch when shutdown was requested.
        await initialization?.catch(() => {});
        await client.destroy().catch(() => {});
        await backup.catch(() => {});
        await rm(directory, { recursive: true, force: true });
      })();

      return stopping;
    };

    const failed = async () => {
      if (closed) return;
      await callbacks.failed().catch(() => {});
      await stop(false).catch(() => {});
    };

    const handle = (action: () => Promise<void>) => {
      if (!closed) void action().catch(failed);
    };

    const scheduleBackup = () => {
      if (closed) return;

      backupTimer = setTimeout(() => {
        // The first minute lets WhatsApp finish synchronizing its multi-device credentials.
        backup = (auth as unknown as SessionBackup).storeRemoteSession({ emit: true });
        void backup.then(scheduleBackup, failed);
      }, 60_000);
      backupTimer.unref();
    };

    client.on('qr', (value) => handle(() => callbacks.qr(value)));
    client.on('ready', () =>
      handle(async () => {
        await callbacks.ready(client.info.wid._serialized);
        clearTimeout(backupTimer);
        scheduleBackup();
      }),
    );
    client.on('auth_failure', () => {
      void failed();
    });
    client.on('disconnected', (reason) =>
      handle(async () => {
        await callbacks.disconnected(reason === 'LOGOUT');
        // Destroy on the next worker tick; waiting here can deadlock upstream's disconnect handler.
      }),
    );
    client.on('message', (message) =>
      handle(async () => {
        if (
          message.fromMe ||
          message.type !== 'chat' ||
          message.hasMedia ||
          !/^\d+@(c\.us|lid)$/.test(message.from) ||
          !message.body.trim() ||
          message.body.length > 8000
        ) {
          return;
        }

        // WhatsApp may identify contacts by LID. Resolve its authenticated phone mapping so
        // an existing phone allowlist still works after WhatsApp switches identifier formats.
        let sender = message.from;

        if (sender.endsWith('@lid')) {
          const contacts = await client.getContactLidAndPhone([sender]);
          const mapped = contacts.find((contact) => contact.lid === sender)?.pn;

          if (mapped && /^\d+@c\.us$/.test(mapped)) {
            sender = mapped;
          }
        }

        // Use the authenticated message's sender, never an actor ID supplied inside its text.
        await callbacks.message({
          actorId: sender,
          chatId: sender,
          text: message.body,
          requestKey: message.id._serialized,
        });
      }),
    );

    return {
      start: () => {
        if (!initialization) {
          initialization = client.initialize();
        }

        return initialization;
      },
      send: async (chatId, text, signal) => {
        if (closed || !/^\d+@(c\.us|lid)$/.test(chatId)) {
          throw new Error('Device unavailable');
        }

        const deadline = AbortSignal.any([signal, AbortSignal.timeout(DEVICE_SEND_TIMEOUT_MS)]);
        deadline.throwIfAborted();
        let abort: () => void = () => {};
        const interrupted = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new Error('WhatsApp send interrupted'));
          deadline.addEventListener('abort', abort, { once: true });
        });

        try {
          const result = await Promise.race([
            client.sendMessage(chatId, text, {
              linkPreview: false,
              sendSeen: false,
              waitUntilMsgSent: true,
            }),
            interrupted,
          ]);

          if (!result?.id._serialized) {
            throw new Error('WhatsApp send was not confirmed');
          }

          return result.id._serialized;
        } catch {
          // Closing the socket prevents later sends; the caller records this effect as uncertain.
          void failed();
          throw new Error('WhatsApp send was not confirmed');
        } finally {
          deadline.removeEventListener('abort', abort);
        }
      },
      stop,
    };
  };
}
