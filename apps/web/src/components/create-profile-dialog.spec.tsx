import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateProfileDialog } from './create-profile-dialog';

describe('CreateProfileDialog', () => {
  it('submits the label and calls onCreate', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateProfileDialog onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));
    await userEvent.type(screen.getByPlaceholderText(/label/i), 'investigator-01');
    await userEvent.click(screen.getByRole('button', { name: /create & open browser/i }));
    expect(onCreate).toHaveBeenCalledWith({ label: 'investigator-01', proxy: null });
  });

  it('does not submit an empty label', async () => {
    const onCreate = vi.fn();
    render(<CreateProfileDialog onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));
    await userEvent.click(screen.getByRole('button', { name: /create & open browser/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
