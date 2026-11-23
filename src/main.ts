import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readEnvironment } from './config/environment.js';

async function bootstrap() {
  const { port } = readEnvironment();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
