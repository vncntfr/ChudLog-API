# ChudLog API

The private ChudLog backend. It contains the Hono HTTP API, SQLite migrations, deterministic domain rules, notification and backup workers, and operator recovery tools. The React PWA lives in the adjacent private `ChudLog` repository.

## Local development

```sh
cp .env.example .env
# Replace every generated-value placeholder before starting.
npm ci
npm run dev
```

The API listens on `http://127.0.0.1:8787`. Run `npm run typecheck`, `npm test`, and `npm run build` before merging.

To run both containers locally with browser-trusted HTTP while keeping the production file HTTPS-only:

```sh
docker compose --env-file .env.production -f compose.yaml -f compose.local.yaml up -d --build
```

## Production configuration

Generate a secret configuration locally without printing its keys:

```sh
npm run env:production -- chudlog.xyz
```

This creates an untracked `.env.production` with mode `0600`. Keep it and the backup encryption key out of Git.

Place the frontend repository beside this one as `../ChudLog`. Then start the combined stack:

```sh
mkdir -p backups
docker compose --env-file .env.production up -d --build
```

The stack exposes ports 80 and 443, stores SQLite in a named volume, serves the PWA with Caddy, and writes encrypted daily snapshots to `BACKUP_HOST_PATH`. On the server, set that path to an off-host mounted filesystem. See `docs/OPERATIONS.md` for restore and push checks.

Use the status-aware [`docs/LAUNCH_CHECKLISTS.md`](docs/LAUNCH_CHECKLISTS.md) for the current deployment sequence and ownership. Review every item in [`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md) before inviting the pilot group.
