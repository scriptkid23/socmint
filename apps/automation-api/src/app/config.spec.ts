import { resolve } from 'node:path';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.dataRoot).toBe(resolve('./data'));
    expect(cfg.artifactsRoot).toBe(resolve('./artifacts'));
    expect(cfg.profileLockTtlMs).toBe(180000);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(3000);
    expect(cfg.binaryPath).toBeNull();
  });

  it('reads overrides from env and resolves roots to absolute paths', () => {
    const cfg = loadConfig({
      DATA_ROOT: './x',
      ARTIFACTS_ROOT: './y',
      PROFILE_LOCK_TTL_MS: '5000',
      HOST: '0.0.0.0',
      PORT: '8080',
      CLOAKBROWSER_BINARY_PATH: '/opt/chromium',
    });
    expect(cfg.dataRoot).toBe(resolve('./x'));
    expect(cfg.artifactsRoot).toBe(resolve('./y'));
    expect(cfg.profileLockTtlMs).toBe(5000);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.port).toBe(8080);
    expect(cfg.binaryPath).toBe('/opt/chromium');
  });
});
