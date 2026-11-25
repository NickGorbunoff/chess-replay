import 'reflect-metadata';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { AppModule } from '../dist/app.module.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { GamesRepository } from '../dist/games/games.repository.js';

const { TEST_DATABASE_URL } = process.env;
if (!TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL in .env or the shell; see .env.example');
}
const testDatabaseUrl = URL.parse(TEST_DATABASE_URL);
if (
  !testDatabaseUrl ||
  testDatabaseUrl.protocol !== 'postgresql:' ||
  testDatabaseUrl.host !== '127.0.0.1:55432' ||
  testDatabaseUrl.username !== 'chessreplay_test' ||
  testDatabaseUrl.pathname !== '/chessreplay_test_admin' ||
  testDatabaseUrl.search ||
  testDatabaseUrl.hash
) {
  throw new Error('TEST_DATABASE_URL must point to the dedicated Compose postgres-test service; see README.md');
}

const admin = new pg.Client({ connectionString: testDatabaseUrl.toString() });
const databaseName = 'chessreplay_test_' + randomUUID().replaceAll('-', '');
const databaseUrl = new URL(testDatabaseUrl);
databaseUrl.pathname = '/' + databaseName;

const pgn = readFileSync(new URL('./fixtures/game.pgn', import.meta.url), 'utf8');
let databaseCreated = false;
let app;
let repository;
let client;

function migrate(url) {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'inherit',
  });
}

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await admin.query(`ALTER DATABASE "${databaseName}" SET TimeZone = 'Europe/Warsaw'`);
  process.env.DATABASE_URL = databaseUrl.toString();
  migrate(databaseUrl);

  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  repository = app.get(GamesRepository);
  client = app.get(DatabaseService).client;
});

after(async () => {
  try {
    try {
      await app?.close();
    } finally {
      if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
});

function game(externalGameId) {
  return {
    provider: 'chess.com',
    externalGameId,
    sourceUrl: 'https://example.test/games/live/123456789',
    pgn,
    whiteUsername: 'maple_knight',
    blackUsername: 'river_bishop',
    endedAt: new Date('2026-11-22T18:45:20.123Z'),
  };
}

test('creates a game and preserves its metadata, timestamps, and original PGN', async () => {
  const input = game('8b331da0-b326-4d73-92d9-f94e36d4ef05');
  const stored = await repository.insertIfAbsent(input);
  const { id, createdAt, updatedAt, ...metadata } = stored;

  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.ok(createdAt instanceof Date && Number.isFinite(+createdAt));
  assert.ok(updatedAt instanceof Date && Number.isFinite(+updatedAt));
  assert.deepEqual(metadata, input);
  assert.deepEqual(await client.game.findUniqueOrThrow({ where: { id } }), stored);
});

test('duplicate imports return the existing row without changing it', async () => {
  const input = game('duplicate');
  const first = await repository.insertIfAbsent(input);
  const duplicate = await repository.insertIfAbsent({ ...input, pgn: pgn + '\n' });

  assert.deepEqual(duplicate, first);
  assert.equal(await client.game.count({ where: { externalGameId: input.externalGameId } }), 1);
});

test('ignores stored IDs and timestamps when inserting under a new source key', async () => {
  const stored = await repository.insertIfAbsent(game('original-source'));
  const oldTimestamp = new Date('2000-01-01T00:00:00Z');
  const { id, createdAt, updatedAt, ...metadata } = await repository.insertIfAbsent({
    ...stored,
    externalGameId: 'new-source',
    createdAt: oldTimestamp,
    updatedAt: oldTimestamp,
  });

  assert.notEqual(id, stored.id);
  assert.ok(createdAt > oldTimestamp);
  assert.ok(updatedAt > oldTimestamp);
  assert.deepEqual(metadata, game('new-source'));
});

test('persists the original endedAt instant when the database defaults to Warsaw time', async (t) => {
  const verifier = new pg.Client({ connectionString: databaseUrl.toString() });
  t.after(() => verifier.end());
  await verifier.connect();
  const { rows: [settings] } = await verifier.query('SHOW TimeZone');
  assert.equal(settings.TimeZone, 'Europe/Warsaw');

  const input = game('timezone-regression');
  const stored = await repository.insertIfAbsent(input);
  assert.deepEqual(stored.endedAt, input.endedAt);

  const { rows: [persisted] } = await verifier.query(
    'SELECT (extract(epoch from "endedAt") * 1000)::bigint AS epoch_ms FROM public."Game" WHERE "id" = $1',
    [stored.id],
  );
  assert.equal(persisted.epoch_ms, String(input.endedAt.getTime()));
});

async function waitForBlockedInsert(blockerPid) {
  // Leave time to finish the transaction before the app's 2-second statement timeout.
  const deadline = performance.now() + 1_200;
  do {
    const { rowCount } = await admin.query(
      `SELECT pid
       FROM pg_stat_activity
       WHERE datname = $1
         AND state = 'active'
         AND query ~ '^[[:space:]]*INSERT INTO'
         AND $2::integer = ANY(pg_blocking_pids(pid))`,
      [databaseName, blockerPid],
    );
    if (rowCount > 0) return;
    await delay(10);
  } while (performance.now() < deadline);
  assert.fail('PostgreSQL did not report the repository INSERT waiting for the first transaction');
}

for (const outcome of ['COMMIT', 'ROLLBACK']) {
  test(`a blocked import handles a competing ${outcome}`, async () => {
    const input = game(`concurrent-${outcome.toLowerCase()}`);
    const competingInput = { ...input, pgn: input.pgn + '\n' };
    const blocker = new pg.Client({ connectionString: databaseUrl.toString(), connectionTimeoutMillis: 2_000 });
    let pending;
    try {
      await blocker.connect();
      const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query('BEGIN');
      const { rows: [first] } = await blocker.query(
        `INSERT INTO public."Game" (
          "id", "provider", "externalGameId", "sourceUrl", "pgn",
          "whiteUsername", "blackUsername", "endedAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        RETURNING *`,
        [randomUUID(), input.provider, input.externalGameId, input.sourceUrl, input.pgn,
          input.whiteUsername, input.blackUsername, input.endedAt],
      );

      pending = repository.insertIfAbsent(competingInput);
      // Attach a handler while polling. Await the original promise to surface any error.
      pending.catch(() => {});
      await waitForBlockedInsert(pid);
      await blocker.query(outcome);

      const stored = await pending;
      if (outcome === 'COMMIT') {
        assert.deepEqual(stored, first);
      } else {
        const { id, createdAt, updatedAt, ...metadata } = stored;
        assert.notEqual(id, first.id);
        assert.deepEqual(metadata, competingInput);
      }

      const rows = await client.game.findMany({
        where: { provider: input.provider, externalGameId: input.externalGameId },
      });
      assert.deepEqual(rows, [stored]);
    } finally {
      // Closing the connection rolls back any transaction left open by a failed assertion.
      try {
        await blocker.end();
      } finally {
        await pending?.catch(() => {});
      }
    }
  });
}

test('PostgreSQL rejects duplicate source identities and permits the same ID for another provider', async () => {
  const input = game('composite-key');
  const first = await client.game.create({ data: input });
  await assert.rejects(client.game.create({ data: input }), (error) => {
    assert.equal(error.code, 'P2002');
    assert.equal(error.meta?.driverAdapterError?.cause?.constraint?.index, 'Game_provider_externalGameId_key');
    return true;
  });

  const second = await repository.insertIfAbsent({ ...input, provider: 'test-provider' });
  assert.notEqual(second.id, first.id);
  assert.equal(second.externalGameId, first.externalGameId);
});

test('PostgreSQL independently enforces the primary key and required PGN', async () => {
  const first = await repository.insertIfAbsent(game('primary-key'));
  await assert.rejects(
    client.game.create({ data: { ...game('other-source'), id: first.id } }),
    (error) => {
      assert.equal(error.code, 'P2002');
      assert.equal(error.meta?.driverAdapterError?.cause?.constraint?.index, 'Game_pkey');
      return true;
    },
  );
  await assert.rejects(
    client.$executeRaw`UPDATE "Game" SET "pgn" = NULL WHERE "id" = ${first.id}::uuid`,
    { code: 'P2010', message: /23502.*null value in column "pgn"/s },
  );
});
