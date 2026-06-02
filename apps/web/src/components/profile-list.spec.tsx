import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileList } from './profile-list';
import type { Profile } from '../api/client';

const profiles: Profile[] = [
  {
    id: 'p1',
    label: 'inv-01',
    proxy: null,
    status: 'idle',
    lastLoginAt: '2026-06-02T00:00:00.000Z',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'p2',
    label: 'inv-02',
    proxy: null,
    status: 'authenticating',
    lastLoginAt: null,
    createdAt: '',
    updatedAt: '',
  },
];

describe('ProfileList', () => {
  it('renders a row per profile with status', () => {
    render(<ProfileList profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('inv-01')).toBeInTheDocument();
    expect(screen.getByText('inv-02')).toBeInTheDocument();
    expect(screen.getByText(/opening browser/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no profiles', () => {
    render(<ProfileList profiles={[]} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument();
  });

  it('calls onLogin with the profile id', async () => {
    const onLogin = vi.fn();
    render(<ProfileList profiles={profiles} onLogin={onLogin} onDelete={() => {}} />);
    await userEvent.click(screen.getAllByRole('button', { name: /log in again/i })[0]);
    expect(onLogin).toHaveBeenCalledWith('p1');
  });
});
