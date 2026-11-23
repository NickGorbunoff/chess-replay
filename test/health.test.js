import 'reflect-metadata';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { DatabaseService } from '../dist/database/database.service.js';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';

async function checkHealth(t, ping) {
  const app = await NestFactory.create(AppModule, { logger: false });
  t.after(() => app.close());
  t.mock.method(app.get(DatabaseService), 'ping', ping);
  await app.listen(0, '127.0.0.1');
  return fetch(new URL('/health', await app.getUrl()));
}

test('GET /health reports ready when the database responds', async (t) => {
  const ping = t.mock.fn(async () => {});
  const response = await checkHealth(t, ping);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
  assert.equal(ping.mock.callCount(), 1);
});

test('GET /health returns 503 when the database check fails', async (t) => {
  const response = await checkHealth(t, async () => {
    throw new Error('database connection failed');
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable', database: 'down' });
});
