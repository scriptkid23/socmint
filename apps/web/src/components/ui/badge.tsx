import type { ReactNode } from 'react';

export function Badge({ inverted = false, children }: { inverted?: boolean; children: ReactNode }) {
  const cls = inverted
    ? 'bg-foreground text-background'
    : 'bg-transparent text-foreground outline outline-[1px] outline-foreground';
  return (
    <span className={`inline-block px-3 py-1 font-mono text-xs uppercase tracking-widest ${cls}`}>
      {children}
    </span>
  );
}
