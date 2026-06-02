export function ProfileNav({ count }: { count: number }) {
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
        <a
          href="#profiles"
          aria-current="page"
          className="block border-b border-border-light bg-foreground px-5 py-4 font-mono text-xs uppercase tracking-widest text-background"
        >
          Profiles
        </a>
      </nav>

      <div className="border-t-2 border-foreground px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {count} profile{count === 1 ? '' : 's'}
        </p>
      </div>
    </aside>
  );
}
