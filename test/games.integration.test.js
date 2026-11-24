import 'reflect-metadata';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
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

before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  process.env.DATABASE_URL = databaseUrl.toString();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    stdio: 'inherit',
  });

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

test('concurrent imports converge on one row and return the winner', async () => {
  const input = game('concurrent');
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      repository.insertIfAbsent({ ...input, sourceUrl: input.sourceUrl + '?attempt=' + index }),
    ),
  );
  const rows = await client.game.findMany({ where: { externalGameId: input.externalGameId } });

  assert.equal(rows.length, 1);
  for (const result of results) assert.deepEqual(result, rows[0]);
});

test('PostgreSQL rejects duplicate source identities and permits the same ID for another provider', async () => {
  const input = game('composite-key');
  const first = await client.game.create({ data: input });
  await assert.rejects(client.game.create({ data: input }), { code: 'P2002' });

  const second = await repository.insertIfAbsent({ ...input, provider: 'test-provider' });
  assert.notEqual(second.id, first.id);
  assert.equal(second.externalGameId, first.externalGameId);
});

test('PostgreSQL independently enforces the primary key and required PGN', async () => {
  const first = await repository.insertIfAbsent(game('primary-key'));
  await assert.rejects(
    client.game.create({ data: { ...game('other-source'), id: first.id } }),
    { code: 'P2002' },
  );
  await assert.rejects(
    client.$executeRaw`UPDATE "Game" SET "pgn" = NULL WHERE "id" = ${first.id}::uuid`,
    { code: 'P2010', message: /23502.*null value in column "pgn"/s },
  );
});
