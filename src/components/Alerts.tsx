import { useState } from 'react';
import { AlertTriangle, BellRing, Info, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Alert, AlertLevel, AlertSettings } from '@/lib/alerts';
import { api } from './shared';
import { Empty, PageHeader, RefreshButton, Section } from './Section';

export type AlertsData = {
  today: string;
  settings: AlertSettings;
  alerts: (Alert & { dismissed: boolean })[];
  email: { on: boolean; last: string | null };
};

const LEVELS: { level: AlertLevel; title: string; Icon: typeof Info; tone: string }[] = [
  { level: 'urgent', title: 'Needs attention', Icon: AlertTriangle, tone: 'text-destructive' },
  { level: 'soon', title: 'Coming up', Icon: BellRing, tone: 'text-warn-foreground' },
  { level: 'info', title: 'For your information', Icon: Info, tone: 'text-muted-foreground' },
];

/** Bills due, 0% offers ending, price increases, new subscriptions and large purchases. Each of you gets them by email too. */
export default function Alerts({ data, demo, onReload, onRefresh, onOpen }: {
  data: AlertsData | null;
  demo: boolean;
  onReload: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpen: (page: Alert['page']) => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: string, body: unknown) => {
    setBusy(key);
    setError(null);
    try {
      await api('/api/alerts', body);
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
        <PageHeader title="Alerts" />
        <Empty>Loading alerts…</Empty>
      </div>
    );
  }

  const active = data.alerts.filter((a) => !a.dismissed);
  const dismissed = data.alerts.filter((a) => a.dismissed);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <PageHeader title="Alerts" subtitle={active.length ? `${active.length} to look at` : 'All clear'}>
        <RefreshButton onRefresh={onRefresh} />
      </PageHeader>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {active.length === 0 && (
        <Section title="Nothing needs you right now">
          <Empty>Bills due soon, 0% offers ending, price increases, new subscriptions and large purchases will show up here.</Empty>
        </Section>
      )}

      {LEVELS.map(({ level, title, Icon, tone }) => {
        const list = active.filter((a) => a.level === level);
        if (!list.length) return null;
        return (
          <Section key={level} title={title} aside={String(list.length)}>
            <ul className="divide-y">
              {list.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => onOpen(a.page)} className="text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none">
                      {a.title}
                    </button>
                    <p className="text-sm text-muted-foreground">{a.detail}</p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Dismiss: ${a.title}`} loading={busy === a.id} disabled={busy !== null}
                    onClick={() => act(a.id, { dismiss: a.id })}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      {dismissed.length > 0 && (
        <div>
          <button type="button" className="text-sm text-primary underline-offset-4 hover:underline" aria-expanded={showDismissed}
            onClick={() => setShowDismissed(!showDismissed)}>
            {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="mt-2 divide-y rounded-2xl border bg-card px-4">
              {dismissed.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.title}</span>
                  <Button variant="ghost" size="sm" loading={busy === a.id} disabled={busy !== null} onClick={() => act(a.id, { restore: a.id })}>
                    <RotateCcw /> Bring back
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AlertOptions key={JSON.stringify(data.settings)} data={data} demo={demo} busy={busy} act={act} />
    </div>
  );
}

function AlertOptions({ data, demo, busy, act }: { data: AlertsData; demo: boolean; busy: string | null; act: (key: string, body: unknown) => Promise<void> }) {
  const [large, setLarge] = useState(String(data.settings.largeCharge));
  const [billDays, setBillDays] = useState(String(data.settings.billDays));
  const [deferralDays, setDeferralDays] = useState(String(data.settings.deferralDays));
  const changed = Number(large) !== data.settings.largeCharge || Number(billDays) !== data.settings.billDays || Number(deferralDays) !== data.settings.deferralDays;
  const field = 'h-9 w-24 rounded-md border bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
  const last = data.email.last ? new Date(data.email.last).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <Section title="Alert settings">
      <form className="grid gap-3 text-sm" onSubmit={(e) => {
        e.preventDefault();
        void act('settings', { settings: { largeCharge: Number(large), billDays: Number(billDays), deferralDays: Number(deferralDays) } });
      }}>
        <label className="flex items-center justify-between gap-3">
          <span>Flag a single purchase of at least</span>
          <span className="flex items-center gap-1">$<input className={field} type="number" inputMode="decimal" min={1} step="any" value={large} onChange={(e) => setLarge(e.target.value)} /></span>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Warn about bills and card payments this many days ahead</span>
          <input className={field} type="number" inputMode="numeric" min={0} max={14} value={billDays} onChange={(e) => setBillDays(e.target.value)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Warn before a 0% or deferred amount ends (days)</span>
          <input className={field} type="number" inputMode="numeric" min={1} max={120} value={deferralDays} onChange={(e) => setDeferralDays(e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">These are shared: they apply to both of you.</p>
        {changed && <div><Button type="submit" loading={busy === 'settings'} disabled={busy !== null}>Save settings</Button></div>}
      </form>

      <div className="mt-4 grid gap-2 border-t pt-4 text-sm">
        <p className="font-medium">Morning email</p>
        {demo ? (
          <p className="text-muted-foreground">Each of you can get these alerts by email every morning. Emails are not sent from the demo.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Your Gmail script emails you anything new each morning around 7, from your Gmail to your Gmail. Each alert is emailed once.
              {last ? ` Last email: ${last}.` : ' No email sent yet: in Settings, copy your Gmail script again and run setup once more.'}
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-primary" checked={data.email.on} disabled={busy !== null}
                onChange={(e) => void act('email', { email: e.target.checked })} />
              Email me my alerts
            </label>
          </>
        )}
      </div>
    </Section>
  );
}
