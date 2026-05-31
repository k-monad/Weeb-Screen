FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@11.3.0 --activate \
  && pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json eslint.config.js vitest.config.ts ./
COPY app ./app
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@11.3.0 --activate \
  && pnpm install --prod --frozen-lockfile

COPY app ./app
COPY --from=build /app/dist ./dist

EXPOSE 8787
CMD ["node", "dist/src/main.js"]

