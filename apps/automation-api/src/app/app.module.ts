import { Module } from '@nestjs/common';
import {
  CloakBrowserLauncher,
  CloakBrowserService,
} from '@socmint/browser-core';
import { ProfilesController } from '../profiles/profiles.controller';
import { ProfileStore } from '../profiles/profile.store';
import { LockService } from '../profiles/lock.service';
import { ProfileService } from '../profiles/profile.service';
import { AuditLogger } from '../runs/audit.logger';
import { RunService } from '../runs/run.service';
import { RunsController } from '../runs/runs.controller';
import { SessionRegistry } from '../sessions/session.registry';
import { SessionsController } from '../sessions/sessions.controller';
import { BoardStore } from '../boards/board.store';
import { BoardService } from '../boards/board.service';
import { BoardsController } from '../boards/boards.controller';
import { RecordingRegistry } from '../recordings/recording.registry';
import { RecordingsController } from '../recordings/recordings.controller';
import { APP_CONFIG, AppConfig, loadConfig } from './config';

@Module({
  controllers: [
    ProfilesController,
    RunsController,
    SessionsController,
    BoardsController,
    RecordingsController,
  ],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: ProfileStore,
      useFactory: (cfg: AppConfig) => new ProfileStore(cfg.dataRoot),
      inject: [APP_CONFIG],
    },
    {
      provide: LockService,
      useFactory: (cfg: AppConfig) => new LockService(cfg.profileLockTtlMs),
      inject: [APP_CONFIG],
    },
    {
      provide: ProfileService,
      useFactory: (store: ProfileStore, lock: LockService, cfg: AppConfig) =>
        new ProfileService(store, lock, cfg.dataRoot),
      inject: [ProfileStore, LockService, APP_CONFIG],
    },
    {
      provide: AuditLogger,
      useFactory: (cfg: AppConfig) => new AuditLogger(cfg.artifactsRoot),
      inject: [APP_CONFIG],
    },
    {
      provide: CloakBrowserService,
      useFactory: () => new CloakBrowserService(new CloakBrowserLauncher()),
    },
    {
      provide: SessionRegistry,
      useFactory: (
        profiles: ProfileService,
        lock: LockService,
        browser: CloakBrowserService,
        audit: AuditLogger,
        cfg: AppConfig,
      ) => new SessionRegistry(profiles, lock, browser, audit, cfg.dataRoot),
      inject: [ProfileService, LockService, CloakBrowserService, AuditLogger, APP_CONFIG],
    },
    {
      provide: RunService,
      useFactory: (
        profiles: ProfileService,
        lock: LockService,
        browser: CloakBrowserService,
        audit: AuditLogger,
        cfg: AppConfig,
      ) => new RunService(profiles, lock, browser, audit, cfg.dataRoot, cfg.artifactsRoot),
      inject: [ProfileService, LockService, CloakBrowserService, AuditLogger, APP_CONFIG],
    },
    {
      provide: BoardStore,
      useFactory: (cfg: AppConfig) => new BoardStore(cfg.dataRoot),
      inject: [APP_CONFIG],
    },
    {
      provide: BoardService,
      useFactory: (store: BoardStore, runs: RunService, recordings: RecordingRegistry) =>
        new BoardService(store, runs, recordings),
      inject: [BoardStore, RunService, RecordingRegistry],
    },
    {
      provide: RecordingRegistry,
      useFactory: (
        profiles: ProfileService,
        lock: LockService,
        browser: CloakBrowserService,
        audit: AuditLogger,
        cfg: AppConfig,
      ) => new RecordingRegistry(profiles, lock, browser, audit, cfg.dataRoot),
      inject: [ProfileService, LockService, CloakBrowserService, AuditLogger, APP_CONFIG],
    },
  ],
})
export class AppModule {}
