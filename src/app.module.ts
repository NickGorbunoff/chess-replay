import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { GamesModule } from './games/games.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [DatabaseModule, GamesModule],
  controllers: [HealthController],
})
export class AppModule {}
