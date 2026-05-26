FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY .npmrc package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY grammars ./grammars
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/grammars ./grammars

EXPOSE 3001

CMD ["node", "dist/index.js", "--port", "3001"]
