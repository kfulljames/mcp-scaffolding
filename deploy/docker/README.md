# Docker deployment

```bash
cp .env.example .env   # fill in real values — never commit this file
docker compose -f deploy/docker/docker-compose.yml up --build
```

The root `Dockerfile` is multi-stage: a build stage with devDependencies compiles TypeScript
and generates the tool catalogue, then a slim runtime stage copies only `dist/`, production
`node_modules`, and `package.json` — no source, no devDependencies, no `.env` in the final
image (`.dockerignore` excludes it explicitly). The runtime stage drops to a non-root `mcp`
user.

For a registry push:

```bash
docker build -t <registry>/<image>:<git-sha> .
docker push <registry>/<image>:<git-sha>
```

Tag by commit SHA, not `latest` — see `docs/DEPLOYMENT.md`'s "Rollback" section for why.
