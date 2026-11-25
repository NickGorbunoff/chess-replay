import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { readEnvironment } from '../config/environment.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    const databaseUrl = new URL(readEnvironment().databaseUrl);
    const options = databaseUrl.searchParams.get('options');
    // PostgreSQL applies startup options on every new connection in the pool.
    databaseUrl.searchParams.set('options', options ? `${options} -c TimeZone=UTC` : '-c TimeZone=UTC');
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl.toString(),
        connectionTimeoutMillis: 2_000,
        query_timeout: 2_000,
        statement_timeout: 2_000,
      }),
    });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
