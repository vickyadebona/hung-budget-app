import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from './ThemeToggle';

/** Uses the browser's own <dialog>, which handles focus, the Escape key and the dimmed backdrop. */
export default function Settings({ open, onClose, userName }: { open: boolean; onClose: () => void; userName: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="settings-title"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50">
      <div className="grid gap-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="settings-title" className="text-base font-semibold">Settings</h2>
          <Button variant="ghost" size="icon" aria-label="Close settings" onClick={onClose}><X /></Button>
        </div>

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Appearance</h3>
          <ThemeToggle />
          <p className="text-xs text-muted-foreground">System follows your device. Your choice is saved on this device only.</p>
        </section>

        <section className="grid gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">Signed in as {userName}</p>
          <form method="post" action="/auth/logout">
            <Button variant="outline" size="lg" type="submit" className="w-full">Sign out</Button>
          </form>
        </section>
      </div>
    </dialog>
  );
}
