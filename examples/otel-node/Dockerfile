# Build context: the repository root.
#
#   docker build -f examples/otel-node/Dockerfile .

# node:24-alpine
FROM docker.io/library/node@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

RUN npm install -g pnpm@12.5.1

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter @calistar/example-otel-node...

WORKDIR /repo/examples/otel-node
USER node
ENV NODE_ENV=production

EXPOSE 8090
HEALTHCHECK --interval=5s --timeout=3s --retries=20 \
  CMD node -e "fetch('http://127.0.0.1:8090/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--require", "./src/telemetry.cjs", "src/server.cjs"]
