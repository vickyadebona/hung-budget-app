import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Budget as BudgetData, BudgetLine } from '@/lib/budget';
import { FREQUENCIES, shiftMonth, type Mapping, type Notice } from '@/lib/budget-rules';
import { api, money } from './shared';

const FREQ_LABEL: Record<string, string> = {
  weekly: 'weekly', biweekly: 'every 2 weeks', 'twice-monthly': 'twice a month', monthly: 'monthly', yearly: 'yearly',
};
// The current month where you live, so the jump back is right even late on the last day of a month.
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const monthName = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const field = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

type ImportPreview = { columns: string[]; mapping: Mapping; rows: { name: string; amount: number; frequency?: string; group?: string; action: string }[]; tableRows: number };
const PICKS: { key: 'name' | 'amount' | 'frequency' | 'group'; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'frequency', label: 'How often' },
  { key: 'group', label: 'Category' },
];

type Draft = { id?: string; name: string; group: string; amount: string; frequency: string; kind: string; direction: string; note: string };
const blank: Draft = { name: '', group: '', amount: '', frequency: 'monthly', kind: 'variable', direction: 'out', note: '' };

export function Notices({ notices, onOpen }: { notices: Notice[]; onOpen?: () => void }) {
  if (notices.length === 0) return null;
  return (
    <ul className="grid gap-2" aria-label="Budget notices">
      {notices.map((n) => (
        <li key={n.lineId}>
          <button type="button" onClick={onOpen} disabled={!onOpen}
            className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm ${n.level === 'over' ? 'bg-destructive/10 text-destructive' : 'bg-warn text-warn-foreground'}`}>
            <span className="min-w-0 truncate font-medium">{n.name}</span>
            <span className="shrink-0 tabular-nums">{n.level === 'over' ? `${money(-n.left)} over` : `${money(n.left)} left`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Bar({ spent, limit }: { spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (spent / limit) * 100)) : spent > 0 ? 100 : 0;
  const tone = spent > limit ? 'bg-destructive' : 'bg-primary';
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Editor({ draft, groups, saving, removing, onSave, onDelete, onCancel }: {
  draft: Draft; groups: string[]; saving: boolean; removing: boolean;
  onSave: (d: Draft) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [sure, setSure] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <form className="grid gap-3 rounded-xl border bg-background p-3" onSubmit={(e) => { e.preventDefault(); onSave(d); }}>
      <label className="grid gap-1 text-xs text-muted-foreground">Name
        <input className={field} value={d.name} onChange={set('name')} required maxLength={80} autoFocus={!d.id} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">Amount
          <input className={field} value={d.amount} onChange={set('amount')} inputMode="decimal" placeholder="0" required />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">How often
          <select className={field} value={d.frequency} onChange={set('frequency')}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Category
          <input className={field} value={d.group} onChange={set('group')} list="budget-groups" placeholder="e.g. Food" maxLength={40} />
          <datalist id="budget-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Type
          <select className={field} value={d.direction === 'in' ? 'in' : d.kind} onChange={(e) => {
            const v = e.target.value;
            setD(v === 'in' ? { ...d, direction: 'in', group: 'Income' } : { ...d, direction: 'out', kind: v, group: d.group === 'Income' ? '' : d.group });
          }}>
            <option value="variable">Flexible spending</option>
            <option value="fixed">Fixed bill</option>
            <option value="in">Income</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">Note (optional)
        <input className={field} value={d.note} onChange={set('note')} maxLength={200} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" type="submit" loading={saving} disabled={removing}>Save</Button>
        <Button size="lg" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {onDelete && (sure
          ? <Button size="lg" type="button" variant="destructive" className="ml-auto" loading={removing} disabled={saving} onClick={onDelete}>Yes, remove it</Button>
          : <Button size="lg" type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => setSure(true)}>Remove</Button>)}
      </div>
    </form>
  );
}

export default function Budget({ initial }: { initial: BudgetData }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // line id, or 'new'
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [restored, setRestored] = useState<number | null>(null);

  const load = useCallback(async (month: string) => setData(await api<BudgetData>(`/api/budget?month=${month}`)), []);
  const [busyKey, setBusyKey] = useState<string | null>(null); // which button started the current action
  const run = useCallback(async (fn: () => Promise<void>, key: string | null = null) => {
    setBusy(true);
    setBusyKey(key);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); setBusyKey(null); }
  }, []);

  const monthLoading = busyKey === 'prev' || busyKey === 'next' || busyKey === 'today';
  const t = data.totals;
  const s = data.suggestion;
  const groupNames = data.groups.map((g) => g.name);
  const outLines = data.groups.filter((g) => g.direction === 'out').flatMap((g) => g.lines);
  const empty = data.groups.length === 0;

  const save = (d: Draft) => run(async () => {
    const amount = Number(d.amount.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Amount needs to be a number, like 250');
    await api('/api/budget/line', { ...d, amount, group: d.direction === 'in' ? 'Income' : d.group });
    setEditing(null);
    await load(data.month);
  }, 'save');
  const remove = (id: string) => run(async () => { await api('/api/budget/line', { id, delete: true }); setEditing(null); await load(data.month); }, 'remove');
  const toDraft = (l: BudgetLine): Draft => ({ id: l.id, name: l.name, group: l.group, amount: String(l.amount), frequency: l.frequency, kind: l.kind, direction: l.direction, note: l.note });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-6">
      <header className="flex items-center justify-between gap-3 pt-2">
        <h1 className="text-xl font-semibold tracking-tight">Budget</h1>
        <div className="flex items-center gap-1">
          {data.month !== thisMonth() && (
            <Button variant="outline" size="sm" className="mr-1" disabled={busy} loading={busyKey === 'today'}
              onClick={() => run(() => load(thisMonth()), 'today')}>Today</Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Previous month" disabled={busy} loading={busyKey === 'prev'} onClick={() => run(() => load(shiftMonth(data.month, -1)), 'prev')}><ChevronLeft /></Button>
          <span className="min-w-32 text-center text-sm font-medium">{monthName(data.month)}</span>
          <Button variant="ghost" size="icon" aria-label="Next month" disabled={busy} loading={busyKey === 'next'} onClick={() => run(() => load(shiftMonth(data.month, 1)), 'next')}><ChevronRight /></Button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Notices notices={data.notices} />
      <div className={`flex flex-col gap-4 transition-opacity ${monthLoading ? 'pointer-events-none opacity-50' : ''}`} aria-busy={monthLoading}>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Income this month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(t.incomeReceived)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">of {money(t.plannedIncome)} planned</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Spent so far</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(t.spent)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">of {money(t.planned)} planned</p>
        </div>
      </div>
      {!empty && (
        <p className={`rounded-xl px-3 py-2 text-sm ${t.leftToPlan < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
          {t.leftToPlan < 0
            ? `The plan spends ${money(-t.leftToPlan)} a month more than the income listed.`
            : `${money(t.leftToPlan)} a month of planned income has no job yet.`}
        </p>
      )}

      {!empty && (
        <details className="rounded-2xl border bg-card p-4 text-card-foreground">
          <summary className="cursor-pointer text-sm font-semibold">
            Suggested amounts for {money(s.income)} of income
            <span className="font-normal text-muted-foreground"> ({s.basedOn === 'received' ? 'what came in' : 'expected this month'})</span>
          </summary>
          <div className="mt-3 grid gap-2 text-sm">
            <p className="flex justify-between gap-3"><span>Fixed bills, paid first</span><span className="tabular-nums">{money(s.fixed)}</span></p>
            <p className="flex justify-between gap-3"><span>Left for flexible spending</span><span className="tabular-nums">{money(Math.max(0, s.available))}</span></p>
            {s.shortfall > 0 ? (
              <p className="text-destructive">Fixed bills alone are {money(s.shortfall)} more than this income, so there is nothing to suggest for flexible spending.</p>
            ) : s.scale >= 1 ? (
              <p className="text-muted-foreground">Your plan fits. {money(s.available - s.flexible)} would be left over for savings or anything else you choose.</p>
            ) : (
              <>
                <p className="text-muted-foreground">To fit, each flexible line shrinks to about {Math.round(s.scale * 100)}% of the plan:</p>
                <ul className="divide-y">
                  {s.lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="tabular-nums text-muted-foreground line-through">{money(l.planned)}</span>
                      <span className="w-20 text-right tabular-nums font-medium">{money(l.suggested)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      )}

      {empty && <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">No budget yet. Add your first line below, or import a spreadsheet.</p>}

      {data.groups.map((g) => (
        <section key={g.name} className="rounded-2xl border bg-card p-4 text-card-foreground">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">{g.name}</h2>
            <span className="text-sm text-muted-foreground tabular-nums">
              {g.direction === 'in' ? `${money(g.planned)} a month` : `${money(g.spent)} of ${money(g.planned)}`}
            </span>
          </div>
          <ul className="divide-y">
            {g.lines.map((l) => (
              <li key={l.id} className="py-2.5">
                {editing === l.id ? (
                  <Editor draft={toDraft(l)} groups={groupNames} saving={busyKey === 'save'} removing={busyKey === 'remove'} onSave={save} onDelete={() => remove(l.id)} onCancel={() => setEditing(null)} />
                ) : (
                  <button type="button" className="block w-full text-left" onClick={() => setEditing(l.id)} aria-label={`Edit ${l.name}`}>
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                      <span className={`shrink-0 tabular-nums ${l.notice?.level === 'over' ? 'text-destructive' : ''}`}>
                        {l.direction === 'in' ? money(l.amount) : `${money(l.spent)} / ${money(l.limit)}`}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {FREQ_LABEL[l.frequency]}{l.direction === 'out' && (l.kind === 'fixed' ? ' · fixed' : ' · flexible')}
                      {l.frequency !== 'monthly' && ` · ${money(l.monthly)} a month`}{l.note && ` · ${l.note}`}
                    </span>
                    {l.direction === 'out' && <Bar spent={l.spent} limit={l.limit} />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      </div>

      {editing === 'new'
        ? <Editor draft={blank} groups={groupNames} saving={busyKey === 'save'} removing={busyKey === 'remove'} onSave={save} onCancel={() => setEditing(null)} />
        : <Button size="lg" variant="outline" onClick={() => setEditing('new')}><Plus /> Add a budget line</Button>}

      {data.unassigned.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 text-card-foreground">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">Needs a category</h2>
            <span className="text-sm text-muted-foreground tabular-nums">{money(t.unassigned)}</span>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">Pick a line once and future charges from the same place go there by themselves.</p>
          <ul className="divide-y">
            {data.unassigned.map((x) => (
              <li key={x.id} className="grid gap-1.5 py-2.5 text-sm">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{x.merchant || x.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{day(x.date)}</span>
                  <span className="shrink-0 tabular-nums">{money(x.amount)}</span>
                </span>
                <select className={field} value="" disabled={busy} aria-label={`Category for ${x.merchant || x.name}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void run(async () => { await api('/api/budget/assign', { txnId: x.id, lineId: v === 'none' ? null : v }); await load(data.month); });
                  }}>
                  <option value="">Choose…</option>
                  {outLines.map((l) => <option key={l.id} value={l.id}>{l.group}: {l.name}</option>)}
                  <option value="none">Not spending (transfer, refund…)</option>
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-2xl border bg-card p-4 text-card-foreground">
        <summary className="cursor-pointer text-sm font-semibold">Import from a spreadsheet</summary>
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted-foreground">
            Upload a .csv file in any layout (in Google Sheets: File, Download, Comma-separated values). You confirm which column is which before anything changes.
            Matching names update that line, new names are added, and nothing is removed.
          </p>
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" aria-label="Spreadsheet file" disabled={busy}
            className="block w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:text-sm file:font-medium"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              void run(async () => {
                setPreview(null);
                setFile(null);
                if (/\.(xlsx?|numbers|ods)$/i.test(f.name)) throw new Error('That is a spreadsheet file, not a .csv. In Google Sheets or Excel, download or save it as CSV first.');
                if (f.size > 500_000) throw new Error('That file is too big to import (500 KB limit).');
                const text = await f.text();
                setPreview(await api<ImportPreview>('/api/budget/import', { text }));
                setFile({ name: f.name, text });
              });
            }} />

          {file && preview && (
            <>
              <p className="font-medium">{file.name} <span className="font-normal text-muted-foreground">· {preview.tableRows} rows read</span></p>
              <div className="grid grid-cols-2 gap-3">
                {PICKS.map((p) => (
                  <label key={p.key} className="grid gap-1 text-xs text-muted-foreground">{p.label} column
                    <select className={field} disabled={busy} value={preview.mapping[p.key]}
                      onChange={(e) => {
                        const mapping = { ...preview.mapping, [p.key]: Number(e.target.value) };
                        void run(async () => setPreview(await api<ImportPreview>('/api/budget/import', { text: file.text, mapping })));
                      }}>
                      {!p.required && <option value={-1}>None</option>}
                      {p.required && preview.mapping[p.key] < 0 && <option value={-1}>Choose…</option>}
                      {preview.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {preview.rows.length === 0
                ? <p className="text-destructive">No rows with both a name and an amount yet. Check the Name and Amount columns above.</p>
                : <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border px-3">
                    {preview.rows.map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{r.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.action === 'update' ? 'updates existing line' : 'new line'}{r.frequency && ` · ${FREQ_LABEL[r.frequency] ?? r.frequency}`}{r.group && ` · ${r.group}`}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{money(r.amount)}</span>
                      </li>
                    ))}
                  </ul>}
              <div className="flex gap-2">
                {preview.rows.length > 0 && (
                  <Button size="lg" disabled={busy} loading={busyKey === 'import'} onClick={() => run(async () => {
                    await api('/api/budget/import', { text: file.text, mapping: preview.mapping, apply: true });
                    setFile(null); setPreview(null); await load(data.month);
                  }, 'import')}>Import {preview.rows.length} {preview.rows.length === 1 ? 'row' : 'rows'}</Button>
                )}
                <Button size="lg" variant="ghost" onClick={() => { setFile(null); setPreview(null); }}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      </details>

      <details className="rounded-2xl border bg-card p-4 text-card-foreground">
        <summary className="cursor-pointer text-sm font-semibold">Backup and restore</summary>
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted-foreground">A backup holds your budget lines and their sorting rules, and no bank data. Use it to move the plan to another copy of this app.</p>
          <a className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted" href="/api/budget/backup" download>Download backup</a>
          <label className="grid gap-1 text-xs text-muted-foreground">Restore from a backup file
            <input type="file" accept=".json,application/json" disabled={busy}
              className="block w-full text-sm text-foreground file:mr-3 file:h-9 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:text-sm file:font-medium"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void run(async () => {
                  let backup: unknown;
                  try { backup = JSON.parse(await f.text()); } catch { throw new Error('That file is not a budget backup'); }
                  const { restored } = await api<{ restored: number }>('/api/budget/backup', { backup });
                  setRestored(restored);
                  await load(data.month);
                });
              }} />
          </label>
          {restored !== null && <p aria-live="polite">Restored {restored} lines.</p>}
        </div>
      </details>
    </div>
  );
}
