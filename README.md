# ChessReplay

ChessReplay is a backend-first project for turning mistakes from completed Chess.com games into personalized puzzles. The current foundation provides a NestJS API and PostgreSQL readiness check.

## Local setup

Install Node.js 24 LTS and Docker with Compose. If you use nvm, run `nvm install` and `nvm use` in the project directory.

```sh
cp .env.example .env
npm ci
docker compose up -d --wait
npm run build
npm start
```

In a second terminal:

```sh
curl --fail-with-body http://localhost:3000/health
```

A ready instance returns HTTP 200 and `{"status":"ok","database":"up"}`. Each check executes `SELECT 1` through Prisma. A failed check returns HTTP 503 and `{"status":"unavailable","database":"down"}`. The app can recover after PostgreSQL comes back without an app restart.

The Compose credentials are local defaults. PostgreSQL is published on loopback port 5432 and uses a named volume. Set `PORT` in `.env` to change the API port. If port 5432 is occupied, change the host port in `compose.yaml` and match it in `DATABASE_URL`.

Use Ctrl+C to stop the API, then run `docker compose down` to stop PostgreSQL. The named volume persists across restarts.

## Checks

```sh
docker compose config --quiet
npm run prisma:validate
npm test
```

`npm test` generates the Prisma client, compiles TypeScript, and exercises the HTTP endpoint with a stubbed database check. The live curl check above verifies the actual Prisma connection. The Prisma schema currently contains only its generator and datasource so setup requires no migrations.
