import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileNav } from './profile-nav';

describe('ProfileNav', () => {
  it('renders the Profiles nav item', () => {
    render(<ProfileNav count={0} />);
    expect(screen.getByText('Profiles')).toBeInTheDocument();
  });

  it('renders the profile count (singular)', () => {
    render(<ProfileNav count={1} />);
    expect(screen.getByText('1 profile')).toBeInTheDocument();
  });

  it('renders the profile count (plural)', () => {
    render(<ProfileNav count={3} />);
    expect(screen.getByText('3 profiles')).toBeInTheDocument();
  });
});
