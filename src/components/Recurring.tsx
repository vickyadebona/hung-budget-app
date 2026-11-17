import type { Summary } from '@/lib/summary';
import { money } from './shared';
import { Empty, PageHeader, Section } from './Section';

const FREQ: Record<string, string> = {
  WEEKLY: 'weekly', BIWEEKLY: 'every 2 weeks', SEMI_MONTHLY: 'twice a month', MONTHLY: 'monthly', ANNUALLY: 'yearly',
  weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly', quarterly: 'every 3 months', yearly: 'yearly', 'every-6-months': 'every 6 months',
};
const often = (f: string) => FREQ[f] ?? (f.startsWith('every-') ? f.replace(/-/g, ' ') : 'repeats');
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Every repeating charge: from the bank, from our own check, and from Apple and Link emails. */
export default function Recurring({ data }: { data: Summary }) {
  const rows = data.recurring;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <PageHeader title="Recurring" subtitle="Subscriptions and bills that repeat" />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Per month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.monthlyRecurring)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Per year</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(data.totals.monthlyRecurring * 12)}</p>
        </div>
      </div>

      <Section title="Recurring charges" aside={rows.length ? `${rows.length} found` : undefined}>
        {rows.length === 0 ? <Empty>Link a bank and recurring charges will show up here.</Empty> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {often(r.frequency)}
                    {r.nextDate && ` · next ${day(r.nextDate)}`}
                    {r.source === 'found' && ' · spotted by our own check'}
                    {r.source === 'apple' && ' · from Apple receipts'}
                    {r.source === 'link' && ' · from Link emails'}
                    {'trial' in r && r.trial && ' · free trial'}
                    {r.priceChanged && ' · price changed'}
                  </p>
                </div>
                <span className="tabular-nums">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
