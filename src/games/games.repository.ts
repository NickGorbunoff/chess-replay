import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';

export interface NewGame {
  provider: string;
  externalGameId: string;
  sourceUrl: string;
  pgn: string;
  whiteUsername: string;
  blackUsername: string;
  endedAt: Date;
}

export interface StoredGame extends NewGame {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class GamesRepository {
  constructor(private readonly database: DatabaseService) {}

  async insertIfAbsent(game: NewGame): Promise<StoredGame> {
    const { provider, externalGameId, sourceUrl, pgn, whiteUsername, blackUsername, endedAt } = game;
    // Raw queries need a qualified table. Escape the configured schema as a SQL identifier.
    const table = Prisma.raw(`"${this.database.schema.replaceAll('"', '""')}"."Game"`);
    const [inserted] = await this.database.client.$queryRaw<StoredGame[]>`
      INSERT INTO ${table} (
        "id", "provider", "externalGameId", "sourceUrl", "pgn",
        "whiteUsername", "blackUsername", "endedAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()}::uuid, ${provider}, ${externalGameId}, ${sourceUrl}, ${pgn},
        ${whiteUsername}, ${blackUsername}, ${endedAt}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("provider", "externalGameId") DO NOTHING
      RETURNING "id", "provider", "externalGameId", "sourceUrl", "pgn",
        "whiteUsername", "blackUsername", "endedAt", "createdAt", "updatedAt"
    `;

    if (inserted) return inserted;

    // A separate statement sees the winner after PostgreSQL resolves the conflict.
    return this.database.client.game.findUniqueOrThrow({
      where: { provider_externalGameId: { provider, externalGameId } },
    });
  }
}
