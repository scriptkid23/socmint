export type ProfileStatus = 'idle' | 'running';

export interface LaunchDefaults {
  headless: boolean;
  geoip: boolean;
}

export interface ProfileMetadata {
  id: string;
  label: string;
  /** Relative path under DATA_ROOT, e.g. "profiles/<id>/user-data". */
  userDataDir: string;
  proxy: string | null;
  fingerprintSeed: string | null;
  launchDefaults: LaunchDefaults;
  /** Display-only; the lock file is authoritative for concurrency. */
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
}
