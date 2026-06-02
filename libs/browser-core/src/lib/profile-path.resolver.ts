import { resolve, sep } from 'node:path';

/** Throw unless `target` is `root` or a descendant of `root`. */
export function assertWithin(root: string, target: string): void {
  const r = resolve(root);
  const t = resolve(target);
  if (t !== r && !t.startsWith(r + sep)) {
    throw new Error(`Path escapes root: ${t} not within ${r}`);
  }
}

function assertSafeId(profileId: string): void {
  if (
    !profileId ||
    profileId.includes('..') ||
    profileId.includes('/') ||
    profileId.includes('\\')
  ) {
    throw new Error(`Invalid profile id: ${profileId}`);
  }
}

export function resolveProfileDir(dataRoot: string, profileId: string): string {
  assertSafeId(profileId);
  const dir = resolve(dataRoot, 'profiles', profileId);
  assertWithin(resolve(dataRoot), dir);
  return dir;
}

export function resolveUserDataDir(dataRoot: string, profileId: string): string {
  const dir = resolve(resolveProfileDir(dataRoot, profileId), 'user-data');
  assertWithin(resolve(dataRoot), dir);
  return dir;
}
