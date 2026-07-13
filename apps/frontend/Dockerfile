FROM oven/bun:1.2.15-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production

COPY bun.lock package.json tsconfig.json bunfig.toml ./
COPY apps/frontend apps/frontend
COPY apps/backend apps/backend
RUN bun install --frozen-lockfile --ignore-scripts \
	&& ln -s /app/node_modules /app/apps/frontend/node_modules \
	&& ln -s /app/node_modules /app/apps/backend/node_modules

FROM deps AS build
ARG VITE_API_URL=http://localhost:3010
ARG VITE_SOCKET_URL=http://localhost:3010
ARG VITE_SOCKET_PATH=/socket.io
ARG VITE_APP_ID=
ARG VITE_APP_SECRET=
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}
ENV VITE_SOCKET_PATH=${VITE_SOCKET_PATH}
ENV VITE_APP_ID=${VITE_APP_ID}
ENV VITE_APP_SECRET=${VITE_APP_SECRET}
RUN cd apps/frontend && rm -rf .output dist .tanstack && bun run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/frontend/.output ./apps/frontend/.output
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY package.json ./package.json

WORKDIR /app/apps/frontend
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O- http://127.0.0.1:80/ || exit 1

CMD ["sh", "-c", "PORT=${PORT:-80} node .output/server/index.mjs"]
