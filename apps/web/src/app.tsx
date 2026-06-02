import { Plus } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { api } from './api/client';
import { useProfiles } from './hooks/use-profiles';
import { ProfileNav } from './components/profile-nav';
import { ProfileTable } from './components/profile-table';
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
    <div className="flex min-h-screen">
      <ProfileNav count={profiles.length} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-foreground px-8 py-6 lg:px-10">
          <div>
            <h1 className="font-display text-3xl tracking-tight">Profiles</h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              CloakBrowser · session capture · local
            </p>
          </div>
          <CreateProfileDialog
            onCreate={handleCreate}
            triggerLabel="New profile"
            triggerClassName="gap-2"
            triggerIcon={<Plus size={16} strokeWidth={1.5} />}
          />
        </header>

        {error && (
          <p className="mx-8 mt-4 shrink-0 border-2 border-foreground bg-foreground px-4 py-3 font-mono text-xs uppercase tracking-widest text-background lg:mx-10">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-8 py-6 lg:px-10">
          <ProfileTable profiles={profiles} onLogin={handleLogin} onDelete={handleDelete} />
        </div>
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
