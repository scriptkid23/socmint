import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileTable } from './profile-table';
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
    proxy: 'http://host:8080',
    status: 'authenticating',
    lastLoginAt: null,
    createdAt: '',
    updatedAt: '',
  },
];

describe('ProfileTable', () => {
  it('renders a row per profile', () => {
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('inv-01')).toBeInTheDocument();
    expect(screen.getByText('inv-02')).toBeInTheDocument();
  });

  it('shows a blinking opening state for an authenticating profile', () => {
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/opening/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no profiles', () => {
    render(<ProfileTable profiles={[]} onLogin={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/no profiles yet/i)).toBeInTheDocument();
  });

  it('calls onLogin with the profile id when Open login is clicked', async () => {
    const onLogin = vi.fn();
    render(<ProfileTable profiles={profiles} onLogin={onLogin} onDelete={() => {}} />);
    await userEvent.click(screen.getAllByRole('button', { name: /open login/i })[0]);
    expect(onLogin).toHaveBeenCalledWith('p1');
  });

  it('calls onDelete with the profile id when Delete is clicked', async () => {
    const onDelete = vi.fn();
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={onDelete} />);
    await userEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('disables actions for an authenticating profile', () => {
    render(<ProfileTable profiles={profiles} onLogin={() => {}} onDelete={() => {}} />);
    // p2 (inv-02) is authenticating; its two buttons are the 2nd login + 2nd delete.
    const loginButtons = screen.getAllByRole('button', { name: /open login/i });
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(loginButtons[1]).toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();
  });
});
