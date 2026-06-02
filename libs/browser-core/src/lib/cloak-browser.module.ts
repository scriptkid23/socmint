import { Module } from '@nestjs/common';
import { CloakBrowserLauncher } from './cloak-browser.launcher';
import { CloakBrowserService } from './cloak-browser.service';
import type { BrowserLauncher } from './types';

export const BROWSER_LAUNCHER = Symbol('BROWSER_LAUNCHER');

/**
 * Thin Nest adapter. Provides CloakBrowserService backed by the real launcher.
 * Non-Nest consumers can ignore this and `new CloakBrowserService(launcher)`
 * directly.
 */
@Module({
  providers: [
    { provide: BROWSER_LAUNCHER, useClass: CloakBrowserLauncher },
    {
      provide: CloakBrowserService,
      useFactory: (launcher: BrowserLauncher) => new CloakBrowserService(launcher),
      inject: [BROWSER_LAUNCHER],
    },
  ],
  exports: [CloakBrowserService, BROWSER_LAUNCHER],
})
export class CloakBrowserModule {}
