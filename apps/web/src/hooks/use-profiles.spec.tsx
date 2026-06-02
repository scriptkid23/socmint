import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProfiles } from './use-profiles';
import { api, type Profile } from '../api/client';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    label: 'inv-01',
    proxy: null,
    status: 'idle',
    lastLoginAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('useProfiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads profiles on mount', async () => {
    vi.spyOn(api, 'listProfiles').mockResolvedValue([profile()]);
    const { result } = renderHook(() => useProfiles(10));
    await waitFor(() => expect(result.current.profiles).toHaveLength(1));
    expect(result.current.profiles[0].label).toBe('inv-01');
  });

  it('polls while authenticating, then stops once idle', async () => {
    const spy = vi
      .spyOn(api, 'listProfiles')
      .mockResolvedValueOnce([profile({ status: 'authenticating' })])
      .mockResolvedValue([profile({ status: 'idle', lastLoginAt: '2026-06-02T00:00:00.000Z' })]);
    renderHook(() => useProfiles(10));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const stable = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(spy.mock.calls.length).toBe(stable);
  });

  it('starts polling after refresh returns authenticating', async () => {
    let calls = 0;
    vi.spyOn(api, 'listProfiles').mockImplementation(async () => {
      calls++;
      if (calls === 1) return [profile()];
      if (calls === 2) return [profile({ status: 'authenticating' })];
      return [profile({ status: 'idle', lastLoginAt: '2026-06-02T00:00:00.000Z' })];
    });
    const { result } = renderHook(() => useProfiles(50));
    await waitFor(() => expect(result.current.profiles[0]?.status).toBe('idle'));

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.profiles[0]?.status).toBe('authenticating'));
    await waitFor(() => expect(result.current.profiles[0]?.status).toBe('idle'));
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
