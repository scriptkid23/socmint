export type NavSection = 'profiles' | 'automation';

export function ProfileNav({ count, active }: { count: number; active: NavSection }) {
  const item = (section: NavSection, label: string) => (
    <a
      href={`#${section}`}
      aria-current={active === section ? 'page' : undefined}
      className={`block border-b border-border-light px-5 py-4 font-mono text-xs uppercase tracking-widest ${
        active === section ? 'bg-foreground text-background' : 'text-foreground'
      }`}
    >
      {label}
    </a>
  );

  return (
    <aside
      className="flex h-screen w-56 shrink-0 flex-col border-r-2 border-foreground bg-background"
      aria-label="Sections"
    >
      <div className="border-b-2 border-foreground px-5 py-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Socmint
        </p>
      </div>

      <nav className="flex-1 py-2">
        {item('profiles', 'Profiles')}
        {item('automation', 'Automation')}
      </nav>

      <div className="border-t-2 border-foreground px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {count} profile{count === 1 ? '' : 's'}
        </p>
      </div>
    </aside>
  );
}
