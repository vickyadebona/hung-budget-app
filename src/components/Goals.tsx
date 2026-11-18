import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Goal, SavingsAccount } from '@/lib/goals';
import { api, money } from './shared';

type Data = { goals: Goal[]; accounts: SavingsAccount[] };
type Draft = { id?: string; name: string; target: string; targetDate: string; accountId: string };

const field = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const blank: Draft = { name: '', target: '', targetDate: '', accountId: '' };
const dateLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Bar({ pct, done }: { pct: number; done: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function GoalForm({ draft, accounts, saving, removing, onSave, onDelete, onCancel }: {
  draft: Draft; accounts: SavingsAccount[]; saving: boolean; removing: boolean;
  onSave: (d: Draft) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [d, setD] = useState(draft);
  const [sure, setSure] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <form className="grid gap-3 rounded-xl border bg-background p-3" onSubmit={(e) => { e.preventDefault(); onSave(d); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="-mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold">{d.id ? `Edit ${draft.name}` : 'New goal'}</p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close without saving" onClick={onCancel}><X /></Button>
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">What are you saving for?
        <input className={field} value={d.name} onChange={set('name')} required maxLength={80} placeholder="e.g. Sony a6700" autoFocus={!d.id} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">Target amount
          <input className={field} value={d.target} onChange={set('target')} inputMode="decimal" placeholder="0" required />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Target date (optional)
          <input className={field} type="date" value={d.targetDate} onChange={set('targetDate')} />
        </label>
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">Savings account
        <select className={field} value={d.accountId} onChange={set('accountId')}>
          <option value="">None, I'll log what I set aside</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.balance != null ? ` · ${money(a.balance)}` : ''}</option>)}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">With an account, the balance counts toward this goal. If several goals share one account, the balance fills them in the order they were created.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" type="submit" loading={saving} disabled={removing}>Save</Button>
        <Button size="lg" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        {onDelete && (sure
          ? <Button size="lg" type="button" variant="destructive" className="ml-auto" loading={removing} disabled={saving} onClick={onDelete}>Yes, delete it</Button>
          : <Button size="lg" type="button" variant="ghost" className="ml-auto text-destructive" onClick={() => setSure(true)}>Delete</Button>)}
      </div>
    </form>
  );
}

function SetAside({ goal, busy, onAdd, onUndo }: { goal: Goal; busy: boolean; onAdd: (amount: number, note: string) => void; onUndo: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'in' | 'out'>('in');
  return (
    <div className="mt-2 grid gap-2">
      {!open ? (
        <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setOpen(true)}><Plus /> Log money set aside</Button>
      ) : (
        <form className="grid gap-2 rounded-xl border bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(amount.replace(/[$,\s]/g, ''));
            if (!Number.isFinite(n) || n <= 0) return;
            onAdd(mode === 'in' ? n : -n, '');
            setAmount(''); setOpen(false);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          <div className="flex items-center justify-between">
            <div className="flex gap-1" role="group" aria-label="Direction">
              <Button type="button" size="sm" variant={mode === 'in' ? 'default' : 'outline'} onClick={() => setMode('in')}>Add</Button>
              <Button type="button" size="sm" variant={mode === 'out' ? 'default' : 'outline'} onClick={() => setMode('out')}>Take out</Button>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}><X /></Button>
          </div>
          <input className={field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" autoFocus aria-label="Amount" />
          <div className="flex gap-2">
            <Button size="lg" type="submit" loading={busy}>Save</Button>
            <Button size="lg" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {goal.entries.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Your entries ({goal.entries.length})</summary>
          <ul className="mt-1 divide-y">
            {goal.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">{dateLabel(e.date)}</span>
                <span className={`tabular-nums ${e.amount < 0 ? 'text-destructive' : ''}`}>{e.amount < 0 ? '−' : '+'}{money(Math.abs(e.amount))}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Undo this entry" disabled={busy} onClick={() => onUndo(e.id)}><X /></Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function Goals() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // goal id or 'new'
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<Data>('/api/goals')); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load goals'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusyKey(key); setError(null);
    try { await fn(); await load(); after?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusyKey(null); }
  };
  const save = (d: Draft) => run('save', () => api('/api/goals/save', d), () => setEditing(null));
  const remove = (id: string) => run('remove', () => api('/api/goals/save', { id, delete: true }), () => setEditing(null));
  const toDraft = (g: Goal): Draft => ({ id: g.id, name: g.name, target: String(g.target), targetDate: g.targetDate ?? '', accountId: g.accountId ?? '' });

  if (!data) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-3 p-4">
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : <div className="h-28 animate-pulse rounded-2xl bg-muted" aria-label="Loading goals" />}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Savings goals</h1>
        <Button size="sm" onClick={() => setEditing('new')} disabled={editing === 'new'}><Plus /> New goal</Button>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {editing === 'new' && <GoalForm draft={blank} accounts={data.accounts} saving={busyKey === 'save'} removing={false} onSave={save} onCancel={() => setEditing(null)} />}
      {data.goals.length === 0 && editing !== 'new' && (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">No goals yet. Add one and point it at your savings account to see your progress.</p>
      )}

      {data.goals.map((g) => (
        <section key={g.id} className="rounded-2xl border bg-card p-4 text-card-foreground">
          {editing === g.id ? (
            <GoalForm draft={toDraft(g)} accounts={data.accounts} saving={busyKey === 'save'} removing={busyKey === 'remove'} onSave={save} onDelete={() => remove(g.id)} onCancel={() => setEditing(null)} />
          ) : (
            <>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{g.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {g.targetDate ? `By ${dateLabel(g.targetDate)}` : 'No date'}{g.accountName ? ` · ${g.accountName}` : ''}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g.id)}><Pencil /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${g.name}`} className="text-destructive" onClick={() => setEditing(g.id)}><Trash2 /></Button>
              </div>
              <div className="mt-3 flex items-baseline justify-between text-sm">
                <span className="font-medium tabular-nums">{money(g.saved)} <span className="font-normal text-muted-foreground">of {money(g.target)}</span></span>
                <span className="tabular-nums text-muted-foreground">{g.pct}%</span>
              </div>
              <div className="mt-1.5"><Bar pct={g.pct} done={g.done} /></div>
              <p className="mt-2 text-xs text-muted-foreground">
                {g.done ? 'Goal reached.'
                  : g.overdue ? `The date has passed. ${money(g.remaining)} to go.`
                  : g.perMonth != null ? `${money(g.perMonth)} a month for ${g.months} ${g.months === 1 ? 'month' : 'months'} gets you there. ${money(g.remaining)} to go.`
                  : `${money(g.remaining)} to go.`}
              </p>
              {g.accountId && g.manual !== 0 && <p className="mt-1 text-xs text-muted-foreground">Includes {money(g.fromAccount)} from the account and {money(g.manual)} you logged.</p>}
              <SetAside goal={g} busy={busyKey === 'entry:' + g.id}
                onAdd={(amount) => run('entry:' + g.id, () => api('/api/goals/entry', { goalId: g.id, amount }))}
                onUndo={(entryId) => run('entry:' + g.id, () => api('/api/goals/entry', { entryId, delete: true }))} />
            </>
          )}
        </section>
      ))}

      {data.accounts.some((a) => a.balance != null && a.extra > 0 && data.goals.some((g) => g.accountId === a.id)) && (
        <p className="text-xs text-muted-foreground">
          {data.accounts.filter((a) => a.extra > 0 && data.goals.some((g) => g.accountId === a.id)).map((a) => `${money(a.extra)} in ${a.label} is not assigned to a goal.`).join(' ')}
        </p>
      )}
    </div>
  );
}
