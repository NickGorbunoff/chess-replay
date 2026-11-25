# ChessReplay

ChessReplay is a backend-first project for turning mistakes from completed Chess.com games into personalized puzzles. The current foundation provides a NestJS API and PostgreSQL readiness check.

## Local setup

Install Node.js 24 LTS and Docker with Compose. If you use nvm, run `nvm install` and `nvm use` in the project directory.

```sh
cp .env.example .env
npm ci
docker compose up -d --wait
npx prisma migrate deploy
npm run build
npm start
```

In a second terminal:

```sh
curl --fail-with-body http://localhost:3000/health
```

A ready instance returns HTTP 200 and `{"status":"ok","database":"up"}`. Each check executes `SELECT 1` through Prisma. A failed check returns HTTP 503 and `{"status":"unavailable","database":"down"}`. The app can recover after PostgreSQL comes back without an app restart.

The Compose credentials are local defaults. PostgreSQL is published on loopback port 5432 and uses a named volume. Set `PORT` in `.env` to change the API port. If port 5432 is occupied, change the host port in `compose.yaml` and match it in `DATABASE_URL`. To use a different PostgreSQL schema, add `?schema=replay` to `DATABASE_URL` before applying migrations and starting the app. The default schema is `public`.

Use Ctrl+C to stop the API, then run `docker compose down` to stop PostgreSQL. The named volume persists across restarts.

## Checks

```sh
docker compose config --quiet
npm run prisma:validate
npm test
```

`npm test` generates the Prisma client, compiles TypeScript, and exercises the HTTP endpoint with a stubbed database check. The live curl check above verifies the actual Prisma connection.

### PostgreSQL integration tests

```sh
npm ci
npm run test:integration
```

The npm command starts the dedicated `postgres-test` Compose service, waits for it to be ready, builds the app, and runs the tests. The service uses temporary storage on a separate PostgreSQL instance. It can run alongside the app database or on its own.

- `TEST_DATABASE_URL` is required. Copy its value from `.env.example` into your existing `.env` or export it in your shell before running the command. The Compose maintenance connection is `postgresql://chessreplay_test:chessreplay_test@127.0.0.1:55432/chessreplay_test_admin`. A shell value takes precedence over `.env`.
- Before connecting, the tests require the test host and port, test role, and maintenance database shown above. Each run creates a uniquely named `chessreplay_test_<id>` database on that instance, points Prisma migrations and the Nest test app at it, and drops only that database on teardown.
- `DATABASE_URL` remains the app's connection setting. The test process replaces it with the temporary database URL before running migrations or initializing Nest.

To stop only the test service:

```sh
docker compose stop postgres-test
```

## Game persistence

- The repository generates an internal UUID for each inserted game. PostgreSQL stores it as a native UUID primary key. External game IDs are text because their format depends on the provider.
- For Chess.com imports, the future adapter will prefer the normalized game UUID. When the UUID is missing, the planned fallback is `url:` followed by the canonical Chess.com game URL, with the query and fragment removed. The repository takes the final external ID as input. If a record later gains a UUID, resolving the earlier URL-based identity is a separate importer concern.
- The unique index on `(provider, externalGameId)` enforces one row per source identity. A check followed by an insert would allow two callers to observe the same missing row. The repository uses `ON CONFLICT (provider, "externalGameId") DO NOTHING` and returns the inserted row when it wins.
- When an insert conflicts with a concurrent import, PostgreSQL resolves the conflict first. The repository reads the stored row in a separate statement so it can see the committed winner. Duplicate requests return that row with its original PGN, metadata, and timestamps. If the winning write rolls back, a competing insert can succeed.
