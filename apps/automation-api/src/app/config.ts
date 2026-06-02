import { resolve } from 'node:path';

export interface AppConfig {
  dataRoot: string;
  artifactsRoot: string;
  profileLockTtlMs: number;
  host: string;
  port: number;
  binaryPath: string | null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    dataRoot: resolve(env.DATA_ROOT ?? './data'),
    artifactsRoot: resolve(env.ARTIFACTS_ROOT ?? './artifacts'),
    profileLockTtlMs: Number(env.PROFILE_LOCK_TTL_MS ?? 180000),
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8081),
    binaryPath: env.CLOAKBROWSER_BINARY_PATH ?? null,
  };
}
