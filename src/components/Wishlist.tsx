import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, PiggyBank, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WishItem, WishLink, Wishlist as Data } from '@/lib/wishlist';
import { api, money } from './shared';

const field = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const dateLabel = (d: string) => new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const chip = 'rounded-full px-2 py-0.5 text-xs font-medium';

type Draft = { id?: string; name: string; targetPrice: string; note: string; url: string };
const blank: Draft = { name: '', targetPrice: '', note: '', url: '' };

function ItemForm({ draft, saving, onSave, onCancel }: { draft: Draft; saving: boolean; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState(draft);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <form className="grid gap-3 rounded-xl border bg-background p-3" onSubmit={(e) => { e.preventDefault(); onSave(d); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="-mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold">{d.id ? `Edit ${draft.name}` : 'New wishlist item'}</p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close without saving" onClick={onCancel}><X /></Button>
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">What is it?
        <input className={field} value={d.name} onChange={set('name')} required maxLength={120} placeholder="e.g. Sony a6700" autoFocus={!d.id} />
      </label>
      {!d.id && (
        <label className="grid gap-1 text-xs text-muted-foreground">Link to a store page (optional)
          <input className={field} value={d.url} onChange={set('url')} inputMode="url" placeholder="https://" />
        </label>
      )}
      <label className="grid gap-1 text-xs text-muted-foreground">Price you would buy at (optional)
        <input className={field} value={d.targetPrice} onChange={set('targetPrice')} inputMode="decimal" placeholder="0" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">Note (optional)
        <input className={field} value={d.note} onChange={set('note')} maxLength={300} />
      </label>
      <div className="flex gap-2">
        <Button size="lg" type="submit" loading={saving}>Save</Button>
        <Button size="lg" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function LinkRow({ link, busy, onPrice, onRemove }: { link: WishLink; busy: boolean; onPrice: (price: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const stale = link.status !== 'ok' && link.status !== 'manual';
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-sm">
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1 font-medium underline-offset-2 hover:underline">
          <span className="truncate">{link.store}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /><span className="sr-only">(opens the store)</span>
        </a>
        {link.best && <span className={`${chip} bg-primary/10 text-primary`}>Cheapest</span>}
        <span className="tabular-nums">{link.price != null ? money(link.price) : 'No price'}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Set the ${link.store} price by hand`} onClick={() => { setVal(link.price != null ? String(link.price) : ''); setEditing(true); }}><Pencil /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove the ${link.store} link`} disabled={busy} onClick={onRemove}><X /></Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {link.inStock === false ? 'Out of stock. ' : ''}
        {link.status === 'manual' ? 'Price entered by hand' : link.status === 'ok' ? 'Price read from the page' : link.message || 'Not checked yet'}
        {link.checkedAt ? ` · ${dateLabel(link.checkedAt.slice(0, 10))}` : ''}
        {stale && link.price == null ? '. Enter the price by hand with the pencil.' : ''}
        {link.previous != null && link.price != null && link.previous !== link.price ? ` · was ${money(link.previous)}` : ''}
      </p>
      {editing && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); onPrice(val); setEditing(false); }} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}>
          <input className={field} value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder="Price" aria-label="Price" autoFocus />
          <Button type="submit">Save</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
    </li>
  );
}

function Item({ item, data, busyKey, run, onEdit }: {
  item: WishItem; data: Data; busyKey: string | null;
  run: (key: string, fn: () => Promise<unknown>, note?: string) => Promise<void>; onEdit: () => void;
}) {
  const [url, setUrl] = useState('');
  const [sure, setSure] = useState(false);
  const waiting = data.sale && !data.sale.now && item.bestPrice != null && item.targetPrice != null && item.bestPrice > item.targetPrice;
  return (
    <section className={`rounded-2xl border bg-card p-4 text-card-foreground ${item.bought ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{item.name}</h2>
          {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${item.name}`} onClick={onEdit}><Pencil /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${item.name}`} className="text-destructive" onClick={() => setSure(true)}><Trash2 /></Button>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xl font-semibold tabular-nums">{item.bestPrice != null ? money(item.bestPrice) : 'No price yet'}</span>
        {item.bestStore && <span className="text-xs text-muted-foreground">at {item.bestStore}</span>}
        {item.targetPrice != null && <span className="text-xs text-muted-foreground">you'd buy at {money(item.targetPrice)}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {item.atTarget && <span className={`${chip} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`}>At your price</span>}
        {item.dropPct != null && <span className={`${chip} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`}>Dropped {item.dropPct}%</span>}
        {item.lowestSeen && <span className={`${chip} bg-primary/10 text-primary`}>Lowest we've seen</span>}
        {item.bought && <span className={`${chip} bg-muted text-muted-foreground`}>Bought</span>}
      </div>
      {waiting && !item.bought && (
        <p className="mt-2 text-xs text-muted-foreground">{data.sale!.name} starts in {data.sale!.daysAway} {data.sale!.daysAway === 1 ? 'day' : 'days'}. If you are not in a rush, it may be worth waiting.</p>
      )}

      {item.links.length > 0 && <ul className="mt-2 divide-y border-t">{item.links.map((l) => (
        <LinkRow key={l.id} link={l} busy={busyKey === 'link:' + l.id}
          onPrice={(price) => run('link:' + l.id, () => api('/api/wishlist/link', { linkId: l.id, price }))}
          onRemove={() => run('link:' + l.id, () => api('/api/wishlist/link', { linkId: l.id, delete: true }))} />
      ))}</ul>}

      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!url.trim()) return; void run('add:' + item.id, () => api('/api/wishlist/link', { itemId: item.id, url })).then(() => setUrl('')); }}>
        <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="Add another store link" aria-label={`Add a store link for ${item.name}`} />
        <Button type="submit" variant="outline" loading={busyKey === 'add:' + item.id}><Plus /> Add</Button>
      </form>

      {sure ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm">Delete this item?</span>
          <Button variant="destructive" loading={busyKey === 'del:' + item.id} onClick={() => run('del:' + item.id, () => api('/api/wishlist/item', { id: item.id, delete: true }))}>Yes, delete it</Button>
          <Button variant="ghost" onClick={() => setSure(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {!item.bought && <Button size="sm" variant="outline" loading={busyKey === 'goal:' + item.id} onClick={() => run('goal:' + item.id, () => api('/api/wishlist/goal', { itemId: item.id }), 'Savings goal created. You can find it on the Goals page.')}><PiggyBank /> Save for this</Button>}
          {!item.bought && item.links.length > 0 && <Button size="sm" variant="outline" loading={busyKey === 'ref:' + item.id} onClick={() => run('ref:' + item.id, () => api('/api/wishlist/refresh', { itemId: item.id }))}><RefreshCw /> Check prices</Button>}
          <Button size="sm" variant="ghost" loading={busyKey === 'got:' + item.id} onClick={() => run('got:' + item.id, () => api('/api/wishlist/item', { id: item.id, bought: !item.bought }))}>{item.bought ? 'Not bought after all' : 'Mark as bought'}</Button>
        </div>
      )}
    </section>
  );
}

export default function Wishlist() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // item id or 'new'
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<Data>('/api/wishlist')); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the wishlist'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, note?: string) => {
    setBusyKey(key); setError(null); setNotice(null);
    try { await fn(); await load(); if (note) setNotice(note); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusyKey(null); }
  };

  const save = (d: Draft) => run('save', async () => {
    const r = await api<{ id: string }>('/api/wishlist/item', { id: d.id, name: d.name, note: d.note, targetPrice: d.targetPrice });
    if (!d.id && d.url.trim()) await api('/api/wishlist/link', { itemId: r.id, url: d.url });
    setEditing(null);
  });

  if (!data) {
    return <div className="mx-auto grid w-full max-w-2xl gap-3 p-4">{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : <div className="h-28 animate-pulse rounded-2xl bg-muted" aria-label="Loading wishlist" />}</div>;
  }
  const open = data.items.filter((i) => !i.bought), bought = data.items.filter((i) => i.bought);
  const toDraft = (i: WishItem): Draft => ({ id: i.id, name: i.name, targetPrice: i.targetPrice != null ? String(i.targetPrice) : '', note: i.note, url: '' });

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Wishlist</h1>
        <div className="flex gap-2">
          {open.some((i) => i.links.length > 0) && <Button size="sm" variant="outline" loading={busyKey === 'refresh'} onClick={() => run('refresh', () => api('/api/wishlist/refresh', {}))}><RefreshCw /> Check prices</Button>}
          <Button size="sm" onClick={() => setEditing('new')} disabled={editing === 'new'}><Plus /> Add item</Button>
        </div>
      </div>

      {data.sale && (
        <p className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-sm" role="status">
          {data.sale.now
            ? `${data.sale.name} sales are on through ${dateLabel(data.sale.endsOn)}. Check prices below before you buy.`
            : `${data.sale.name} is in ${data.sale.daysAway} ${data.sale.daysAway === 1 ? 'day' : 'days'} (${dateLabel(data.sale.date)}). Prices are checked once a day, and you will see drops here.`}
        </p>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}

      {editing === 'new' && <ItemForm draft={blank} saving={busyKey === 'save'} onSave={save} onCancel={() => setEditing(null)} />}
      {open.length === 0 && editing !== 'new' && <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">Nothing on the wishlist yet. Add something you want and paste a store link to track its price.</p>}

      {open.map((i) => editing === i.id
        ? <ItemForm key={i.id} draft={toDraft(i)} saving={busyKey === 'save'} onSave={save} onCancel={() => setEditing(null)} />
        : <Item key={i.id} item={i} data={data} busyKey={busyKey} run={run} onEdit={() => setEditing(i.id)} />)}

      {bought.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Bought ({bought.length})</summary>
          <div className="mt-2 grid gap-3">{bought.map((i) => <Item key={i.id} item={i} data={data} busyKey={busyKey} run={run} onEdit={() => setEditing(i.id)} />)}</div>
        </details>
      )}
    </div>
  );
}
