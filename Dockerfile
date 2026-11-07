# Helm agent image, built from the repo root (Maritime GitHub-source builds use this file).
# The web app deploys separately (Vercel/Render); this image is only the per-student agent.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY agent/package.json agent/
RUN pnpm install --frozen-lockfile --filter @helm/agent...
COPY packages/shared packages/shared
COPY agent agent
RUN pnpm --filter @helm/agent build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/agent/dist/server.mjs ./server.mjs
CMD ["node", "/app/server.mjs"]
