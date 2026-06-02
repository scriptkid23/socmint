import { useCallback, useEffect, useState } from 'react';
import { api, type Profile } from '../api/client';

export function useProfiles(pollMs = 1500) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.listProfiles();
      setProfiles(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles');
      return null;
    }
  }, []);

  const isAuthenticating = profiles.some((p) => p.status === 'authenticating');

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while any profile is authenticating (restarts when refresh() sets authenticating).
  useEffect(() => {
    if (!isAuthenticating) return;

    const id = setInterval(() => {
      void refresh();
    }, pollMs);

    return () => clearInterval(id);
  }, [isAuthenticating, pollMs, refresh]);

  return { profiles, error, refresh };
}
