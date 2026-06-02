import { LogIn, Trash2 } from 'lucide-react';
import type { Profile } from '../api/client';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function formatDate(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '—';
}

const HEADERS = ['Label', 'Status', 'Last login', 'Proxy', 'ID', 'Actions'];

export function ProfileTable({
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
      <p className="px-2 py-12 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        No profiles yet. Create one to open a browser for login.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-left" aria-label="Profiles">
      <thead>
        <tr className="border-b-2 border-foreground">
          {HEADERS.map((h) => (
            <th
              key={h}
              className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => {
          const busy = p.status === 'authenticating';
          return (
            <tr key={p.id} className="border-b border-border-light align-middle">
              <td className="px-4 py-4 font-serif text-base">{p.label}</td>
              <td className="px-4 py-4">
                {busy ? (
                  <span className="animate-mono-blink font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Opening…
                  </span>
                ) : (
                  <Badge>Idle</Badge>
                )}
              </td>
              <td className="px-4 py-4 font-mono text-xs">{formatDate(p.lastLoginAt)}</td>
              <td className="px-4 py-4 break-all font-mono text-xs">{p.proxy ?? '—'}</td>
              <td className="px-4 py-4 break-all font-mono text-[10px] text-muted-foreground">
                {p.id}
              </td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => onLogin(p.id)}
                    className="h-8 gap-1.5 px-3 py-1.5 text-[11px]"
                  >
                    <LogIn size={14} strokeWidth={1.5} />
                    Open login
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onDelete(p.id)}
                    className="h-8 gap-1.5 px-3 py-1.5 text-[11px]"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
