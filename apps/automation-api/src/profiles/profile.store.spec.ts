import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProfileStore } from './profile.store';
import type { ProfileMetadata } from './profile.types';

function sampleProfile(id: string): ProfileMetadata {
  return {
    id,
    label: 'investigator-01',
    userDataDir: `profiles/${id}/user-data`,
    proxy: null,
    fingerprintSeed: null,
    launchDefaults: { headless: false, geoip: false },
    status: 'idle',
    lastLoginAt: null,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  };
}

describe('ProfileStore', () => {
  let dataRoot: string;
  let store: ProfileStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'socmint-store-'));
    store = new ProfileStore(dataRoot);
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('write then read round-trips the metadata and creates user-data dir', async () => {
    const p = sampleProfile('id-1');
    await store.write(p);
    const onDisk = JSON.parse(
      await readFile(resolve(dataRoot, 'profiles', 'id-1', 'profile.json'), 'utf8'),
    );
    expect(onDisk).toEqual(p);
    expect(await store.read('id-1')).toEqual(p);
  });

  it('read returns null for a missing profile', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('list returns all written profiles', async () => {
    await store.write(sampleProfile('id-1'));
    await store.write(sampleProfile('id-2'));
    const ids = (await store.list()).map((p) => p.id).sort();
    expect(ids).toEqual(['id-1', 'id-2']);
  });

  it('remove deletes the whole profile tree', async () => {
    await store.write(sampleProfile('id-1'));
    await store.remove('id-1');
    expect(await store.read('id-1')).toBeNull();
  });
});
