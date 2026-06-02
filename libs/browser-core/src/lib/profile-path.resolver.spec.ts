import { resolve } from 'node:path';
import {
  assertWithin,
  resolveProfileDir,
  resolveUserDataDir,
} from './profile-path.resolver';

const ROOT = resolve('/tmp/socmint-data');

describe('profile-path.resolver', () => {
  it('resolves the profile dir under DATA_ROOT', () => {
    expect(resolveProfileDir(ROOT, 'abc-123')).toBe(
      resolve(ROOT, 'profiles', 'abc-123'),
    );
  });

  it('resolves the user-data dir under the profile dir', () => {
    expect(resolveUserDataDir(ROOT, 'abc-123')).toBe(
      resolve(ROOT, 'profiles', 'abc-123', 'user-data'),
    );
  });

  it('rejects a profileId containing traversal or separators', () => {
    expect(() => resolveProfileDir(ROOT, '../../etc')).toThrow(/invalid profile id/i);
    expect(() => resolveProfileDir(ROOT, 'a/b')).toThrow(/invalid profile id/i);
    expect(() => resolveProfileDir(ROOT, 'a\\b')).toThrow(/invalid profile id/i);
  });

  it('assertWithin throws when target escapes root', () => {
    expect(() => assertWithin(ROOT, resolve(ROOT, '..', 'evil'))).toThrow(/escapes/i);
  });

  it('assertWithin passes for the root itself and children', () => {
    expect(() => assertWithin(ROOT, ROOT)).not.toThrow();
    expect(() => assertWithin(ROOT, resolve(ROOT, 'child'))).not.toThrow();
  });
});
