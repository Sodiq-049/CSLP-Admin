# syntax=docker/dockerfile:1.7
# One Dockerfile, three runtime targets:
#   docker build --target api    -t cslp-api .
#   docker build --target worker -t cslp-worker .
#   docker build --target admin  -t cslp-admin .
ARG NODE_VERSION=22.14.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# ── install + build everything once ──
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/admin/package.json apps/admin/
COPY packages/server-core/package.json packages/server-core/
COPY packages/validation/package.json packages/validation/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/api-client/package.json packages/api-client/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN NEXT_OUTPUT=standalone pnpm turbo run build --filter=@cslp/api --filter=@cslp/worker --filter=@cslp/admin
# Self-contained production trees (workspace packages are copied in, dev deps dropped).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @cslp/api deploy --prod /out/api && cp -r apps/api/dist /out/api/dist && \
    pnpm --filter @cslp/worker deploy --prod /out/worker && cp -r apps/worker/dist /out/worker/dist

# ── runtime images ──
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
USER node
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/public/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker /app
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM runtime AS admin
# Next.js standalone output: server.js plus only the files it traces as needed.
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/static /app/apps/admin/.next/static
USER node
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
