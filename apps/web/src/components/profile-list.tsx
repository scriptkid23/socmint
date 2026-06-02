import { LogIn, Trash2 } from 'lucide-react';
import type { Profile } from '../api/client';
import { Badge } from './ui/badge';

function formatDate(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}

export function ProfileList({
  profiles,
  onLogin,
  onDelete,
}: {
  profiles: Profile[];
  onLogin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (profiles.length === 0) {
    return (
      <div className="border-t-4 border-foreground py-32 text-center">
        <p className="font-display text-5xl tracking-tight md:text-7xl">No profiles yet.</p>
        <p className="mt-6 font-mono text-sm uppercase tracking-widest text-muted-foreground">
          Create one to capture a login session.
        </p>
      </div>
    );
  }

  return (
    <table className="w-full border-collapse border-t-4 border-foreground">
      <thead>
        <tr className="border-b-2 border-foreground text-left font-mono text-xs uppercase tracking-widest">
          <th className="py-4 pr-4">Label</th>
          <th className="py-4 pr-4">Status</th>
          <th className="py-4 pr-4">Last login</th>
          <th className="py-4 pr-4 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => (
          <tr
            key={p.id}
            className="group border-b border-foreground transition-colors duration-100 hover:bg-foreground hover:text-background"
          >
            <td className="py-5 pr-4 font-serif text-lg">{p.label}</td>
            <td className="py-5 pr-4">
              {p.status === 'authenticating' ? (
                <span className="font-mono text-xs uppercase tracking-widest">
                  <span className="animate-mono-blink">Opening browser —</span>
                </span>
              ) : (
                <Badge>Idle</Badge>
              )}
            </td>
            <td className="py-5 pr-4 font-mono text-sm">{formatDate(p.lastLoginAt)}</td>
            <td className="py-5 pr-4">
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => onLogin(p.id)}
                  disabled={p.status === 'authenticating'}
                  className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:opacity-40"
                >
                  <LogIn size={16} strokeWidth={1.5} /> Log in again
                </button>
                <button
                  onClick={() => onDelete(p.id)}
                  disabled={p.status === 'authenticating'}
                  className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:opacity-40"
                >
                  <Trash2 size={16} strokeWidth={1.5} /> Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
