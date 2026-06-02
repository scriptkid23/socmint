import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileNav } from './profile-nav';

describe('ProfileNav', () => {
  it('renders Profiles and Automation nav items', () => {
    render(<ProfileNav count={0} active="profiles" />);
    expect(screen.getByText('Profiles')).toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
  });

  it('marks the active section', () => {
    render(<ProfileNav count={0} active="automation" />);
    expect(screen.getByRole('link', { name: 'Automation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Profiles' })).not.toHaveAttribute('aria-current');
  });

  it('renders the profile count (singular)', () => {
    render(<ProfileNav count={1} active="profiles" />);
    expect(screen.getByText('1 profile')).toBeInTheDocument();
  });

  it('renders the profile count (plural)', () => {
    render(<ProfileNav count={3} active="profiles" />);
    expect(screen.getByText('3 profiles')).toBeInTheDocument();
  });
});
