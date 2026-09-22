import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Gateway } from '../src/gateway.js';
import { MemoryStore } from './helpers/memory-store.js';

it('serves the exported UI with hashed scripts without opening API or filesystem access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elos-ui-'));
  const script = 'window.__elos = true;';
  const html = `<html><script>${script}</script><body>Elos</body></html>`;
  const token = 'ui-test-admin-token-at-least-32-characters';

  await writeFile(join(root, 'index.html'), html);
  await writeFile(join(root, '.secret'), 'must-never-be-served');
  await writeFile(join(root, 'app.js'), 'console.log("elos");');

  const app = createApp({
    gateway: new Gateway(new MemoryStore()),
    token,
    logger: false,
    uiRoot: root,
  });

  try {
    for (const path of ['/', '/ui']) {
      const redirect = await app.inject(path);

      expect(redirect.statusCode).toBe(302);
      expect(redirect.headers.location).toBe('/ui/');
    }

    const page = await app.inject('/ui/');

    expect(page.statusCode).toBe(200);
    expect(page.body).toBe(html);

    expect(page.headers['content-security-policy']).toContain(
      `'sha256-${createHash('sha256').update(script).digest('base64')}'`,
    );

    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    expect(page.headers['content-security-policy']).not.toContain(
      "script-src 'self' 'unsafe-inline'",
    );

    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject('/ui/app.js')).statusCode).toBe(200);
    expect((await app.inject({ method: 'HEAD', url: '/ui/' })).statusCode).toBe(200);
    expect((await app.inject('/v1/profiles')).statusCode).toBe(401);

    expect(
      (await app.inject({ url: '/v1/profiles', headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(200);

    for (const path of ['/ui/.secret', '/ui/%2e%2e/package.json', '/ui/%2e%2e/v1/profiles']) {
      const response = await app.inject(path);

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('must-never-be-served');
    }

    expect((await app.inject({ method: 'POST', url: '/ui/' })).statusCode).toBe(401);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
