import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Summary } from '@/lib/summary';
import { shiftMonth } from '@/lib/budget-rules';
import { calendarItems, dayTotal, monthBounds, type CalendarItem } from '@/lib/calendar';
import { money } from './shared';
import { Empty, PageHeader, RefreshButton, Section } from './Section';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const monthName = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_AHEAD = 12; // months

const DOT: Record<CalendarItem['kind'], string> = { recurring: 'bg-primary', card: 'bg-warn-foreground', deferral: 'bg-destructive' };
const KIND_LABEL: Record<CalendarItem['kind'], string> = { recurring: 'Recurring', card: 'Card payment', deferral: '0% / deferred ends' };

/** A month grid of what is coming up: recurring charges, card payments and 0% offers ending. Tap a day for its list. */
export default function Calendar({ data, onRefresh }: { data: Summary; onRefresh: () => Promise<void> }) {
  const now = today();
  const current = now.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [picked, setPicked] = useState<string | null>(null);

  const items = useMemo(() => calendarItems(
    month, now,
    data.recurring.map((r) => ({ label: r.label, amount: r.amount, frequency: r.frequency, nextDate: r.nextDate })),
    data.cards.map((c) => ({ name: c.name, mask: c.mask, details: c.details, state: c.state })),
    data.cards.map((c) => ({ name: c.name, mask: c.mask, plans: c.deferrals.plans })),
  ), [data, month, now]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const i of items) (m.get(i.date) ?? m.set(i.date, []).get(i.date)!).push(i);
    return m;
  }, [items]);

  const { from, to } = monthBounds(month);
  const lead = new Date(from + 'T12:00:00Z').getUTCDay();
  const days = Number(to.slice(8));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const total = dayTotal(items);
  const selected = picked && picked.startsWith(month) ? picked : null;
  const listed = selected ? byDay.get(selected) ?? [] : items;
  const go = (m: string) => { setMonth(m); setPicked(null); };
  const lastMonth = shiftMonth(current, MAX_AHEAD);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-6">
      <PageHeader title="Calendar" subtitle={monthName(month)}>
        <RefreshButton onRefresh={onRefresh} />
        {month !== current && <Button variant="outline" size="sm" onClick={() => go(current)}>This month</Button>}
        <Button variant="ghost" size="icon" aria-label="Previous month" disabled={month <= current} onClick={() => go(shiftMonth(month, -1))}><ChevronLeft /></Button>
        <Button variant="ghost" size="icon" aria-label="Next month" disabled={month >= lastMonth} onClick={() => go(shiftMonth(month, 1))}><ChevronRight /></Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">{month === current ? 'Still to pay this month' : 'Due this month'}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(total)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Payments</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{items.filter((i) => i.kind !== 'deferral').length}</p>
        </div>
      </div>

      <section className="rounded-2xl border bg-card p-2 text-card-foreground sm:p-3" aria-label={`${monthName(month)} calendar`}>
        <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium text-muted-foreground" aria-hidden="true">
          {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={`blank-${i}`} aria-hidden="true" />;
            const list = byDay.get(d) ?? [];
            const sum = dayTotal(list);
            const past = d < now;
            const isToday = d === now;
            const isPicked = d === selected;
            return (
              <button key={d} type="button" onClick={() => setPicked(isPicked ? null : d)} aria-pressed={isPicked}
                aria-label={`${longDay(d)}${list.length ? `, ${list.length} payment${list.length > 1 ? 's' : ''}${sum ? `, ${money(sum)}` : ''}` : ''}`}
                className={`flex min-h-14 flex-col items-stretch gap-0.5 rounded-lg border p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-24 sm:p-1.5
                  ${isPicked ? 'border-primary bg-primary/10' : list.length ? 'bg-background hover:bg-muted' : 'border-transparent hover:bg-muted/50'}
                  ${past ? 'opacity-40' : ''}`}>
                <span className={`text-xs tabular-nums ${isToday ? 'grid size-5 place-items-center rounded-full bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground'}`}>
                  {Number(d.slice(8))}
                </span>
                {list.length > 0 && (
                  <>
                    {/* Phones: dots and the day's total. Wider screens: the first few names. */}
                    <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                      {list.slice(0, 4).map((it, k) => <span key={k} className={`size-1.5 rounded-full ${DOT[it.kind]}`} />)}
                    </span>
                    {sum > 0 && <span className="truncate text-[10px] font-medium tabular-nums sm:hidden">{money(Math.round(sum)).replace('.00', '')}</span>}
                    <span className="hidden flex-col gap-0.5 sm:flex" aria-hidden="true">
                      {list.slice(0, 3).map((it, k) => (
                        <span key={k} className="flex items-center gap-1 text-[11px] leading-tight">
                          <span className={`size-1.5 shrink-0 rounded-full ${DOT[it.kind]}`} />
                          <span className="truncate">{it.label}</span>
                        </span>
                      ))}
                      {list.length > 3 && <span className="text-[11px] text-muted-foreground">+{list.length - 3} more</span>}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 px-1 pt-2 text-[11px] text-muted-foreground">
          {(Object.keys(DOT) as CalendarItem['kind'][]).map((k) => (
            <span key={k} className="flex items-center gap-1"><span className={`size-2 rounded-full ${DOT[k]}`} />{KIND_LABEL[k]}</span>
          ))}
        </div>
      </section>

      <Section title={selected ? longDay(selected) : `All of ${monthName(month)}`}
        aside={selected ? <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setPicked(null)}>Show whole month</button> : undefined}>
        {listed.length === 0 ? <Empty>{selected ? 'Nothing due this day.' : 'Nothing due for the rest of this month.'}</Empty> : (
          <ul className="divide-y">
            {listed.map((it, k) => (
              <li key={`${it.date}-${it.label}-${k}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                {!selected && <span className="min-w-14 shrink-0 text-muted-foreground">{new Date(it.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium"><span className={`size-2 shrink-0 rounded-full ${DOT[it.kind]}`} /><span className="truncate">{it.label}</span></p>
                  <p className="truncate text-xs text-muted-foreground">
                    {it.note ?? KIND_LABEL[it.kind]}{it.kind === 'recurring' && it.estimated && ' · expected from its schedule'}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{it.amount == null ? '—' : money(it.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
