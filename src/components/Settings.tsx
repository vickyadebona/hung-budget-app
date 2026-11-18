import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from './ThemeToggle';
import { api } from './shared';

type AppleSetup = { script: string; receipts: number; lastSent: string | null; linkEmails: number; linkLastSent: string | null };

function AppleReceipts() {
  const [setup, setSetup] = useState<AppleSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () => api<AppleSetup>('/api/apple/setup').then(setSetup, (e) => setError(e instanceof Error ? e.message : 'Could not load'));

  return (
    <details className="group" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !setup) void load(); }}>
      <summary className="cursor-pointer text-sm font-medium">Gmail: Apple and Link subscriptions, and alert emails</summary>
      <div className="mt-2 grid gap-2 text-sm">
        <p className="text-muted-foreground">
          A small script in your own Google account sends your Apple receipts and Link purchase emails here every 6 hours. It sends only
          shop names, prices and dates, never your address, card or name. It also emails you the app's alerts each morning, from your
          Gmail to your Gmail. Each of you sets it up from your own sign-in. Already set up? Copy it again and run setup once more to get alert emails.
        </p>
        {error && <p className="text-destructive">{error}</p>}
        {setup && (
          <>
            <p className="font-medium">
              {setup.receipts > 0
                ? `Working: ${setup.receipts} receipts received${setup.lastSent ? `, last on ${new Date(setup.lastSent).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.`
                : 'Not set up yet.'}
              {setup.receipts > 0 && ` Link: ${setup.linkEmails > 0 ? `${setup.linkEmails} emails received.` : 'none yet. If you set this up before Link was added, copy the script again and run setup once more.'}`}
            </p>
            <ol className="grid list-decimal gap-1 pl-5 text-muted-foreground">
              <li>Copy your script below.</li>
              <li>Open <a className="text-primary underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">a new Google Apps Script project</a>, signed in to the Gmail that gets your Apple receipts.</li>
              <li>Replace everything there with the script, then click Save.</li>
              <li>Make sure <b>setup</b> is picked next to Run, click Run, and allow access when Google asks.</li>
              <li>Come back here in a minute: the counts above go up and your Apple and Link subscriptions appear on Overview.</li>
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
export default function Settings({ open, onClose, userName, demo = false }: { open: boolean; onClose: () => void; userName: string; demo?: boolean }) {
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

        {!demo && (
          <section className="grid gap-2 border-t pt-4">
            <AppleReceipts />
          </section>
        )}

        {demo ? (
          <section className="grid gap-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">You're viewing the demo. Every account and amount is made up, and changes here are not kept.</p>
            <form method="post" action="/auth/logout">
              <Button variant="outline" size="lg" type="submit" className="w-full">Leave the demo</Button>
            </form>
          </section>
        ) : (
          <>
            <section className="grid gap-2 border-t pt-4">
              <h3 className="text-sm font-medium">Showing someone the app?</h3>
              <p className="text-xs text-muted-foreground">
                Switch to the demo: made-up accounts instead of yours. This signs you out, so getting back to your real data needs a full sign-in.
              </p>
              <form method="post" action="/auth/demo">
                <Button variant="outline" size="lg" type="submit" className="w-full">Switch to the demo</Button>
              </form>
            </section>

            <section className="grid gap-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">Signed in as {userName}</p>
              <form method="post" action="/auth/logout">
                <Button variant="outline" size="lg" type="submit" className="w-full">Sign out</Button>
              </form>
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}
