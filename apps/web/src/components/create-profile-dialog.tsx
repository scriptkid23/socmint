import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from './ui/dialog';

export function CreateProfileDialog({
  onCreate,
}: {
  onCreate: (body: { label: string; proxy: string | null }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [proxy, setProxy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await onCreate({ label: label.trim(), proxy: proxy.trim() || null });
      setOpen(false);
      setLabel('');
      setProxy('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create profile</Button>
      </DialogTrigger>
      <DialogContent title="New profile">
        <div className="space-y-8">
          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Label
            </span>
            <Input
              placeholder="Label (e.g. investigator-01)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Proxy (optional)
            </span>
            <Input
              placeholder="http://user:pass@host:port"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
          </label>
          <div className="flex items-center justify-between border-t-2 border-foreground pt-6">
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={submit} disabled={busy}>
              Create &amp; open browser <ArrowRight size={16} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
