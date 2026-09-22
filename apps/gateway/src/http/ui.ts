import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    publicUiAsset?: boolean;
  }
}

const embeddedRoot = fileURLToPath(new URL('../../dist/ui/', import.meta.url));

/** Static Next exports contain inline hydration scripts. Hash them instead of allowing arbitrary scripts. */
function contentPolicies(root: string): Map<string, string> {
  const policies = new Map<string, string>();

  for (const file of readdirSync(root, { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.html')) {
      continue;
    }

    const path = join(root, file);
    const html = readFileSync(path, 'utf8');

    const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .filter((match) => match[1])
      .map(
        (match) =>
          `'sha256-${createHash('sha256')
            .update(match[1] as string)
            .digest('base64')}'`,
      );

    policies.set(
      path,
      [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; '),
    );
  }

  return policies;
}

export function registerGatewayUi(app: FastifyInstance, root = embeddedRoot) {
  // Tests and API-only source runs can omit the export. A production build always embeds it.
  if (!existsSync(join(root, 'index.html'))) {
    return;
  }

  const policies = contentPolicies(root);

  // The bare host is how people reach the panel; without this it answers 404.
  for (const path of ['/', '/ui']) {
    app.get(path, { config: { publicUiAsset: true } }, async (_request, reply) =>
      reply.redirect('/ui/'),
    );
  }

  void app.register(async (scope) => {
    scope.addHook('onRoute', (route) => {
      route.config = { ...route.config, publicUiAsset: true };
    });

    await scope.register(fastifyStatic, {
      root,
      prefix: '/ui/',
      decorateReply: false,
      dotfiles: 'deny',
      index: ['index.html'],
      setHeaders(reply, path) {
        const policy = policies.get(path);

        if (policy) {
          reply.header('Content-Security-Policy', policy);
          reply.header('Cache-Control', 'no-cache');
        }
      },
    });
  });
}
