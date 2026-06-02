import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CloakBrowserLauncher } from '@socmint/browser-core';
import { AppModule } from './app/app.module';
import { loadConfig } from './app/config';
import { DomainExceptionFilter } from './app/domain-exception.filter';
import { setupSwagger } from './app/swagger';
import { LockService } from './profiles/lock.service';

async function bootstrap() {
  const cfg = loadConfig();

  await new CloakBrowserLauncher().ensureBinary();

  await new LockService(cfg.profileLockTtlMs).clearStaleUnder(
    resolve(cfg.dataRoot, 'profiles'),
  );

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  setupSwagger(app);

  try {
    await app.listen(cfg.port, cfg.host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EADDRINUSE') {
      Logger.error(
        `Port ${cfg.port} is already in use on ${cfg.host}. Stop the other listener (often a previous nx serve) or set PORT in .env.`,
        undefined,
        'Bootstrap',
      );
    }
    throw err;
  }

  Logger.log(`automation-api listening on http://${cfg.host}:${cfg.port}`, 'Bootstrap');
  Logger.log(`Swagger UI: http://${cfg.host}:${cfg.port}/docs`, 'Bootstrap');
}

bootstrap();
