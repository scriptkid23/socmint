import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProfileDto, UpdateProfileDto } from './dto';

function errorsFor<T extends object>(cls: new () => T, payload: unknown) {
  return validateSync(plainToInstance(cls, payload), { whitelist: true });
}

describe('CreateProfileDto', () => {
  it('accepts a minimal valid payload', () => {
    expect(errorsFor(CreateProfileDto, { label: 'inv-01' })).toHaveLength(0);
  });

  it('rejects a missing/empty label', () => {
    expect(errorsFor(CreateProfileDto, {}).length).toBeGreaterThan(0);
    expect(errorsFor(CreateProfileDto, { label: '' }).length).toBeGreaterThan(0);
  });

  it('accepts optional proxy, fingerprintSeed and launchDefaults', () => {
    const errs = errorsFor(CreateProfileDto, {
      label: 'inv-01',
      proxy: 'http://1.2.3.4:8080',
      fingerprintSeed: 'seed',
      launchDefaults: { headless: true, geoip: false },
    });
    expect(errs).toHaveLength(0);
  });
});

describe('UpdateProfileDto', () => {
  it('accepts an empty patch', () => {
    expect(errorsFor(UpdateProfileDto, {})).toHaveLength(0);
  });

  it('rejects a non-boolean headless inside launchDefaults', () => {
    const errs = errorsFor(UpdateProfileDto, { launchDefaults: { headless: 'yes' } });
    expect(errs.length).toBeGreaterThan(0);
  });
});
