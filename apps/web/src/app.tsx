import { Toaster, toast } from 'sonner';
import { api } from './api/client';
import { useProfiles } from './hooks/use-profiles';
import { ProfileList } from './components/profile-list';
import { CreateProfileDialog } from './components/create-profile-dialog';

export function App() {
  const { profiles, error, refresh } = useProfiles();

  const handleCreate = async (body: { label: string; proxy: string | null }) => {
    try {
      const created = await api.createProfile(body);
      await api.openLoginSession(created.id);
      toast('Browser opening — log in, then close the window to save.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create profile');
    }
  };

  const handleLogin = async (id: string) => {
    try {
      await api.openLoginSession(id);
      toast('Browser opening — log in, then close the window to save.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open login session');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProfile(id);
      toast('Profile deleted.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete profile');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:px-8 lg:px-12">
      <header className="mb-12">
        <div className="flex items-end justify-between gap-6">
          <h1 className="font-display text-6xl tracking-tighter md:text-8xl">PROFILES</h1>
          <CreateProfileDialog onCreate={handleCreate} />
        </div>
        <div className="mt-6 flex items-center gap-4">
          <div className="h-1 flex-1 bg-foreground" />
          <div className="h-3 w-3 border border-foreground" />
        </div>
        <p className="mt-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          CloakBrowser session capture · local
        </p>
      </header>

      {error && (
        <p className="mb-6 border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background">
          {error}
        </p>
      )}

      <ProfileList profiles={profiles} onLogin={handleLogin} onDelete={handleDelete} />

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
