import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { GamesRepository } from './games.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [GamesRepository],
  exports: [GamesRepository],
})
export class GamesModule {}
