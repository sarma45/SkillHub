# AI Engineering Cockpit — production image
# Build:  docker build -t cockpit .
# Run:    docker run -p 3000:3000 -e COCKPIT_AUTH_PASSWORD=... -v cockpit-data:/app/data cockpit
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- deps (layer cached) ---
COPY package.json package-lock.json tsconfig.base.json vitest.config.ts ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/model-gateway/package.json packages/model-gateway/
COPY packages/policy/package.json packages/policy/
COPY packages/ui/package.json packages/ui/
COPY services/repo-parser/package.json services/repo-parser/
COPY services/planning-service/package.json services/planning-service/
COPY services/execution-engine/package.json services/execution-engine/
COPY services/memory-service/package.json services/memory-service/
COPY services/context-service/package.json services/context-service/
COPY services/browser-service/package.json services/browser-service/
COPY services/security-service/package.json services/security-service/
COPY services/skill-registry/package.json services/skill-registry/
COPY services/routing-service/package.json services/routing-service/
COPY services/extraction-service/package.json services/extraction-service/
COPY services/evaluation-service/package.json services/evaluation-service/
RUN npm ci

# --- build ---
COPY . .
RUN npm run build

# --- runtime ---
ENV NODE_ENV=production
ENV COCKPIT_REPO_ROOT=/app
ENV COCKPIT_DB_FILE=/app/data/cockpit.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "scripts/prod.mjs"]
