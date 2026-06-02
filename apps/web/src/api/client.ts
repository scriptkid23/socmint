export interface Profile {
  id: string;
  label: string;
  proxy: string | null;
  status: 'idle' | 'authenticating';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = String(body.message);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listProfiles: () => req<Profile[]>('/profiles'),
  getProfile: (id: string) => req<Profile>(`/profiles/${id}`),
  createProfile: (body: { label: string; proxy?: string | null }) =>
    req<Profile>('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (id: string, body: { label?: string; proxy?: string | null }) =>
    req<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProfile: (id: string) => req<void>(`/profiles/${id}`, { method: 'DELETE' }),
  openLoginSession: (id: string) =>
    req<{ sessionId: string; status: 'authenticating' }>(`/profiles/${id}/login-session`, {
      method: 'POST',
    }),
  closeLoginSession: (id: string) =>
    req<void>(`/profiles/${id}/login-session`, { method: 'DELETE' }),
};
