FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
ENV HUSKY=0 CI=true PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .husky/install.mjs .husky/install.mjs
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/gateway-ui/package.json apps/gateway-ui/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN pnpm install --frozen-lockfile
COPY apps/gateway apps/gateway
COPY apps/gateway-ui apps/gateway-ui
COPY packages packages
RUN pnpm build && pnpm --filter @jian/gateway --prod deploy --legacy /runtime

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 JIAN_WHATSAPP_CHROMIUM=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /runtime ./
USER node
EXPOSE 4310
CMD ["node", "dist/main.js"]
