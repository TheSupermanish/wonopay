# Builds the Wono app (target `web`) and the example store (target `store`).
#   docker buildx build --platform linux/amd64 -f deploy/Dockerfile --target web -t wono-web .
FROM node:24-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/x402/package.json packages/x402/
COPY packages/react/package.json packages/react/
COPY apps/web/package.json apps/web/
COPY examples/react-store/package.json examples/react-store/
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npm run build -w @wono/sdk && npm run build -w @wono/x402 && npm run build -w @wono/react \
  && npm run build -w @wono/web && npm run build -w @wono/example-react-store

FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3080 WONO_DATABASE_PATH=/data/wono.sqlite
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3080
CMD ["node", "apps/web/server.js"]

FROM node:24-slim AS store
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3091
COPY --from=build /repo/examples/react-store/.next/standalone ./
COPY --from=build /repo/examples/react-store/.next/static ./examples/react-store/.next/static
USER node
EXPOSE 3091
CMD ["node", "examples/react-store/server.js"]
