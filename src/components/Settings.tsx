import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from './ThemeToggle';
import { api } from './shared';

type AppleSetup = { script: string; receipts: number; lastSent: string | null };

function AppleReceipts() {
  const [setup, setSetup] = useState<AppleSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () => api<AppleSetup>('/api/apple/setup').then(setSetup, (e) => setError(e instanceof Error ? e.message : 'Could not load'));

  return (
    <details className="group" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !setup) void load(); }}>
      <summary className="cursor-pointer text-sm font-medium">Apple subscriptions from Gmail</summary>
      <div className="mt-2 grid gap-2 text-sm">
        <p className="text-muted-foreground">
          A small script in your own Google account sends your Apple receipts here every 6 hours. It sends only the item names and prices,
          never your address or card. Each of you sets it up from your own sign-in.
        </p>
        {error && <p className="text-destructive">{error}</p>}
        {setup && (
          <>
            <p className="font-medium">
              {setup.receipts > 0
                ? `Working: ${setup.receipts} receipts received${setup.lastSent ? `, last on ${new Date(setup.lastSent).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.`
                : 'Not set up yet.'}
            </p>
            <ol className="grid list-decimal gap-1 pl-5 text-muted-foreground">
              <li>Copy your script below.</li>
              <li>Open <a className="text-primary underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">a new Google Apps Script project</a>, signed in to the Gmail that gets your Apple receipts.</li>
              <li>Replace everything there with the script, then click Save.</li>
              <li>Make sure <b>setup</b> is picked next to Run, click Run, and allow access when Google asks.</li>
              <li>Come back here in a minute: the count above goes up and your Apple list appears on Overview.</li>
            </ol>
            <Button variant="outline" size="lg" onClick={() => {
              void navigator.clipboard.writeText(setup.script).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
            }}>{copied ? <><Check /> Copied</> : <><Copy /> Copy my script</>}</Button>
            <p className="text-xs text-muted-foreground">The script contains your personal key. Don't share it.</p>
          </>
        )}
      </div>
    </details>
  );
}

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
      className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50">
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
          <AppleReceipts />
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
