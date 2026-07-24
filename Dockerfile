# syntax=docker/dockerfile:1

FROM node:22.12-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build && npm run generate:catalogue && npm prune --omit=dev

FROM node:22.12-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Never bake .env / secrets into the image — supplied at run time (--env-file,
# orchestrator secret injection, or a mounted Key Vault CSI driver). See docs/DEPLOYMENT.md.
RUN groupadd --system --gid 1001 mcp && useradd --system --uid 1001 --gid mcp mcp
COPY --from=build --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=build --chown=mcp:mcp /app/dist ./dist
COPY --from=build --chown=mcp:mcp /app/package.json ./package.json
USER mcp

# Liveness probe target — see docs/DEPLOYMENT.md for the live/ready split and why
# this Dockerfile does not itself declare a HEALTHCHECK against /health/vendor.
EXPOSE 3000

CMD ["node", "dist/src/index.js"]
