import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

export default function configuration(phase) {
  return {
    output: 'export',
    basePath: '/ui',
    trailingSlash: true,
    poweredByHeader: false,
    images: { unoptimized: true },
    devIndicators: false,
    ...(phase === PHASE_DEVELOPMENT_SERVER
      ? {
          // basePath makes the dev server answer only under /ui; in production the Gateway
          // is what redirects the bare host.
          async redirects() {
            return [{ source: '/', destination: '/ui/', basePath: false, permanent: false }];
          },
          // Production calls the same origin; this proxy exists only for the separate dev server.
          async rewrites() {
            return [
              {
                source: '/v1/:path*',
                destination: 'http://127.0.0.1:4310/v1/:path*',
                basePath: false,
              },
            ];
          },
        }
      : {}),
  };
}
