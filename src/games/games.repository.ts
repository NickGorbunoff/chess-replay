import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

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
    const [inserted] = await this.database.client.game.createManyAndReturn({
      data: { provider, externalGameId, sourceUrl, pgn, whiteUsername, blackUsername, endedAt },
      skipDuplicates: true,
    });

    if (inserted) return inserted;

    // A separate statement sees the winner after PostgreSQL resolves the conflict.
    return this.database.client.game.findUniqueOrThrow({
      where: { provider_externalGameId: { provider, externalGameId } },
    });
  }
}
