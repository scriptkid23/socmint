import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CloakBrowserLauncher } from '@socmint/browser-core';
import { AppModule } from './app/app.module';
import { loadConfig } from './app/config';
import { DomainExceptionFilter } from './app/domain-exception.filter';
import { LockService } from './profiles/lock.service';

async function bootstrap() {
  const cfg = loadConfig();

  await new CloakBrowserLauncher().ensureBinary();

  await new LockService(cfg.profileLockTtlMs).clearStaleUnder(
    resolve(cfg.dataRoot, 'profiles'),
  );

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());

  await app.listen(cfg.port, cfg.host);
  Logger.log(`automation-api listening on http://${cfg.host}:${cfg.port}`, 'Bootstrap');
}

bootstrap();
