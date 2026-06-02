import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useProfiles } from './hooks/use-profiles';
import { ProfileNav, type NavSection } from './components/profile-nav';
import { ProfilesPage } from './components/profiles-page';
import { AutomationPage } from './components/automation/automation-page';

function useHashSection(): NavSection {
  const read = (): NavSection =>
    window.location.hash === '#automation' ? 'automation' : 'profiles';
  const [section, setSection] = useState<NavSection>(read);
  useEffect(() => {
    const onHash = () => setSection(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return section;
}

export function App() {
  const section = useHashSection();
  const { profiles } = useProfiles();

  return (
    <div className="flex min-h-screen">
      <ProfileNav count={profiles.length} active={section} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'automation' ? <AutomationPage /> : <ProfilesPage />}
      </main>

      <Toaster
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'border-2 border-foreground bg-background px-4 py-3 font-mono text-xs uppercase tracking-widest text-foreground',
            error:
              'border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background',
          },
        }}
      />
    </div>
  );
}
