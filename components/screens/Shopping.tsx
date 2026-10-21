'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase.ts';
import { formatLong, relativeDay, today } from '@/lib/dates.ts';
import { isRunningLow, pantryDaysLeft } from '@/lib/schedule.ts';
import { CATEGORIES, type PantryProduct, type ShoppingItem, type ShoppingList } from '@/lib/types.ts';
import { useStore } from '../store';
import { Avatar, CheckButton, Empty, ErrorText, PageTitle, Sheet, errorMessage } from '../ui';
import { Icon } from '../Icon';

export default function Shopping() {
  const { data, me, memberById, patchLocal, removeLocal } = useStore();
  const [listId, setListId] = useState(data.lists[0]?.id ?? '');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [editingList, setEditingList] = useState<ShoppingList | 'new' | null>(null);
  const [pantryOpen, setPantryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = data.lists.find((l) => l.id === listId) ?? data.lists[0];
  const items = list ? data.items.filter((i) => i.list_id === list.id) : [];
  const pending = items.filter((i) => !i.purchased);
  const bought = items.filter((i) => i.purchased);
  const groups = [...CATEGORIES.map((c) => ({ c, rows: pending.filter((i) => i.category === c) })), { c: 'Autre', rows: pending.filter((i) => !CATEGORIES.includes(i.category)) }].filter((g) => g.rows.length);

  const low = data.pantry
    .filter((p) => isRunningLow(p.last_purchased_on, p.duration_days, today()))
    .map((p) => ({ p, left: pantryDaysLeft(p.last_purchased_on, p.duration_days, today()) }))
    .sort((a, b) => a.left - b.left);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!list || !name.trim()) return;
    setError(null);
    const { data: row, error } = await supabase
      .from('shopping_items')
      .insert({ list_id: list.id, household_id: data.household.id, name: name.trim(), quantity: quantity.trim() || null, category, requested_by: me.id })
      .select()
      .single<ShoppingItem>();
    if (error) return setError(errorMessage(error));
    patchLocal('items', row);
    setName('');
    setQuantity('');
  }

  async function toggle(item: ShoppingItem) {
    const next = { ...item, purchased: !item.purchased };
    patchLocal('items', next);
    const { error } = await supabase.from('shopping_items').update({ purchased: next.purchased }).eq('id', item.id);
    if (error) {
      patchLocal('items', item);
      return setError(errorMessage(error));
    }
    // Acheté : le compteur du garde-manger repart de zéro.
    if (next.purchased) {
      const product = data.pantry.find((p) => p.id === item.pantry_product_id || p.name.toLowerCase() === item.name.trim().toLowerCase());
      if (product) {
        patchLocal('pantry', { ...product, last_purchased_on: today() });
        await supabase.from('pantry_products').update({ last_purchased_on: today() }).eq('id', product.id);
      }
    }
  }

  async function remove(ids: string[]) {
    ids.forEach((id) => removeLocal('items', id));
    const { error } = await supabase.from('shopping_items').delete().in('id', ids);
    if (error) setError(errorMessage(error));
  }

  const shopper = memberById(list?.shopper_id);

  const row = (i: ShoppingItem) => {
    const by = memberById(i.requested_by);
    return (
      <li key={i.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
        <CheckButton checked={i.purchased} onClick={() => toggle(i)} label={i.name} />
        <div className="min-w-0 flex-1">
          <p className={`flex flex-wrap items-center gap-2 font-semibold ${i.purchased ? 'text-muted line-through' : ''}`}>
            {i.name}
            {i.quantity && <span className="font-normal text-muted">{i.quantity}</span>}
            {i.is_automatic && <span className="tag">Auto</span>}
          </p>
          {by && !i.purchased && <p className="text-xs text-muted">Demandé par {by.id === me.id ? 'toi' : by.name}</p>}
        </div>
        <button className="flex size-9 items-center justify-center rounded-[10px] text-muted" onClick={() => remove([i.id])} aria-label={`Retirer ${i.name}`}>
          <Icon name="close" size={18} />
        </button>
      </li>
    );
  };

  return (
    <>
      <PageTitle title="Courses" subtitle={`${pending.length} article${pending.length > 1 ? 's' : ''} à acheter`} />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="tablist">
        {data.lists.map((l) => {
          const n = data.items.filter((i) => i.list_id === l.id && !i.purchased).length;
          const on = l.id === list?.id;
          return (
            <button
              key={l.id}
              role="tab"
              aria-selected={on}
              onClick={() => setListId(l.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border-[3px] border-ink px-4 py-2 font-semibold ${on ? 'bg-ink text-cream' : ''}`}
            >
              {l.name}
              {n > 0 && <span className={`rounded-full px-2 text-xs ${on ? 'bg-rose text-ink' : 'bg-blush'}`}>{n}</span>}
            </button>
          );
        })}
        <button className="shrink-0 rounded-full border-[3px] border-dashed border-ink px-3" onClick={() => setEditingList('new')} aria-label="Nouvelle liste">
          <Icon name="plus" size={18} />
        </button>
      </div>

      {low.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="section-title">Bientôt fini</h2>
            <button className="btn-link text-sm" onClick={() => setPantryOpen(true)}>Garde-manger</button>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {low.map(({ p, left }) => (
              <div key={p.id} className="card w-40 shrink-0 bg-blush p-3">
                <span className="tag bg-cream">Auto</span>
                <p className="mt-2 leading-tight font-semibold">{p.name}</p>
                <p className="text-sm text-muted">{left <= 0 ? 'Terminé' : `Encore ~${left} j`}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {list && (
        <>
          <button className="card flex items-center gap-3 px-4 py-3 text-left" onClick={() => setEditingList(list)}>
            <Avatar member={shopper} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{shopper ? (shopper.id === me.id ? 'Tu y vas' : `${shopper.name} y va`) : "Personne n'y va encore"}</span>
              <span className="text-sm text-muted">{list.date ? formatLong(list.date) : 'Choisir qui y va et quand'}</span>
            </span>
            <Icon name="next" />
          </button>

          <form className="grid grid-cols-[1fr_76px] gap-2" onSubmit={add}>
            <input className="input col-span-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ajouter un produit…" aria-label="Produit" enterKeyHint="done" />
            <div className="col-span-2 grid grid-cols-[76px_1fr_48px] gap-2">
              <input className="input px-2" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qté" aria-label="Quantité" />
              <select className="input min-w-0 px-2" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Rayon">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <button className="flex items-center justify-center rounded-[10px] bg-action text-cream" aria-label="Ajouter"><Icon name="plus" size={24} stroke={2.5} /></button>
            </div>
          </form>
          <ErrorText>{error}</ErrorText>

          {groups.length ? (
            groups.map((g) => (
              <section key={g.c}>
                <h2 className="section-title">{g.c}</h2>
                <ul className="card divide-y-[3px] divide-ink overflow-hidden">{g.rows.map(row)}</ul>
              </section>
            ))
          ) : (
            <Empty>La liste est vide. Ajoutez ce qui manque au fur et à mesure.</Empty>
          )}

          {bought.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="section-title">Dans le panier</h2>
                <button className="btn-link text-sm" onClick={() => remove(bought.map((i) => i.id))}>Vider</button>
              </div>
              <ul className="card divide-y-[3px] divide-ink overflow-hidden">{bought.map(row)}</ul>
            </section>
          )}

          {low.length === 0 && (
            <button className="btn w-full" onClick={() => setPantryOpen(true)}><Icon name="jar" size={20} /> Garde-manger</button>
          )}
        </>
      )}

      {editingList && (
        <ListSheet
          list={editingList === 'new' ? null : editingList}
          onClose={() => setEditingList(null)}
          onCreated={setListId}
          onDeleted={() => setListId(data.lists.find((l) => l.id !== list?.id)?.id ?? '')}
        />
      )}
      {pantryOpen && <PantrySheet onClose={() => setPantryOpen(false)} />}
    </>
  );
}

function ListSheet({ list, onClose, onCreated, onDeleted }: { list: ShoppingList | null; onClose: () => void; onCreated: (id: string) => void; onDeleted: () => void }) {
  const { data, me, patchLocal, removeLocal } = useStore();
  const [name, setName] = useState(list?.name ?? '');
  const [shopperId, setShopperId] = useState<string | null>(list?.shopper_id ?? null);
  const [date, setDate] = useState(list?.date ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = { household_id: data.household.id, name: name.trim(), shopper_id: shopperId, date: date || null };
    const res = list
      ? await supabase.from('shopping_lists').update(payload).eq('id', list.id).select().single<ShoppingList>()
      : await supabase.from('shopping_lists').insert(payload).select().single<ShoppingList>();
    if (res.error) return setError(errorMessage(res.error));
    patchLocal('lists', res.data);
    if (!list) onCreated(res.data.id);
    onClose();
  }

  async function remove() {
    if (!list || !confirm(`Supprimer la liste « ${list.name} » et ses articles ?`)) return;
    const { error } = await supabase.from('shopping_lists').delete().eq('id', list.id);
    if (error) return setError(errorMessage(error));
    removeLocal('lists', list.id);
    onDeleted();
    onClose();
  }

  return (
    <Sheet title={list ? list.name : 'Nouvelle liste'} onClose={onClose}>
      <form className="space-y-5" onSubmit={save}>
        <label className="block">
          <span className="label">Nom de la liste</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Marché du dimanche" />
        </label>
        <div>
          <span className="label">Qui y va ?</span>
          <div className="flex flex-wrap gap-2">
            {data.members.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={shopperId === m.id}
                onClick={() => setShopperId(shopperId === m.id ? null : m.id)}
                className={`flex min-h-12 items-center gap-2 rounded-full border-[3px] px-3 font-semibold ${shopperId === m.id ? 'border-action bg-blush' : 'border-ink'}`}
              >
                <Avatar member={m} size={24} /> {m.id === me.id ? 'Moi' : m.name}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="label">Quand ?</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full">Enregistrer</button>
        {list && data.lists.length > 1 && (
          <button type="button" className="btn w-full text-action" onClick={remove}><Icon name="trash" size={18} /> Supprimer la liste</button>
        )}
      </form>
    </Sheet>
  );
}

function PantrySheet({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const [editing, setEditing] = useState<PantryProduct | 'new' | null>(null);
  const rows = data.pantry.map((p) => ({ p, left: pantryDaysLeft(p.last_purchased_on, p.duration_days, today()) })).sort((a, b) => a.left - b.left);

  if (editing) return <PantryForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <Sheet title="Garde-manger" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">Quand il reste 20 % de la durée d’un produit, il passe dans « Bientôt fini » et s’ajoute seul à la liste du supermarché.</p>
      {rows.length ? (
        <ul className="card mb-4 divide-y-[3px] divide-ink overflow-hidden">
          {rows.map(({ p, left }) => {
            const ratio = Math.max(0, Math.min(1, left / p.duration_days));
            const low = isRunningLow(p.last_purchased_on, p.duration_days, today());
            return (
              <li key={p.id}>
                <button className="w-full px-4 py-3 text-left" onClick={() => setEditing(p)}>
                  <span className="flex justify-between gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-sm text-muted">{left <= 0 ? 'Terminé' : `${left} j`}</span>
                  </span>
                  <span className="mt-2 block h-3 overflow-hidden rounded-full border-2 border-ink">
                    <span className={`block h-full ${low ? 'bg-action' : 'bg-rose'}`} style={{ width: `${ratio * 100}%` }} />
                  </span>
                  <span className="mt-1 block text-xs text-muted">Acheté {relativeDay(p.last_purchased_on).toLowerCase()} · dure {p.duration_days} j</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mb-4"><Empty>Ajoutez ce que vous rachetez souvent : café, lessive, papier toilette…</Empty></div>
      )}
      <button className="btn-primary w-full" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Ajouter un produit</button>
    </Sheet>
  );
}

function PantryForm({ product, onClose }: { product: PantryProduct | null; onClose: () => void }) {
  const { data, patchLocal, removeLocal } = useStore();
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? CATEGORIES[0]);
  const [duration, setDuration] = useState(product?.duration_days ?? 14);
  const [last, setLast] = useState(product?.last_purchased_on ?? today());
  const [error, setError] = useState<string | null>(null);

  async function save(boughtToday = false) {
    const payload = { household_id: data.household.id, name: name.trim(), category, duration_days: duration, last_purchased_on: boughtToday ? today() : last };
    const res = product
      ? await supabase.from('pantry_products').update(payload).eq('id', product.id).select().single<PantryProduct>()
      : await supabase.from('pantry_products').insert(payload).select().single<PantryProduct>();
    if (res.error) return setError(errorMessage(res.error));
    patchLocal('pantry', res.data);
    // Racheté : l'article automatique encore en attente n'a plus lieu d'être.
    if (boughtToday) {
      const pending = data.items.filter((i) => i.pantry_product_id === res.data.id && !i.purchased);
      pending.forEach((i) => removeLocal('items', i.id));
      if (pending.length) await supabase.from('shopping_items').delete().in('id', pending.map((i) => i.id));
    }
    onClose();
  }

  async function remove() {
    if (!product || !confirm(`Retirer « ${product.name} » du garde-manger ?`)) return;
    const { error } = await supabase.from('pantry_products').delete().eq('id', product.id);
    if (error) return setError(errorMessage(error));
    removeLocal('pantry', product.id);
    onClose();
  }

  return (
    <Sheet title={product ? product.name : 'Nouveau produit'} onClose={onClose}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="block">
          <span className="label">Produit</span>
          <input className="input" required autoFocus={!product} value={name} onChange={(e) => setName(e.target.value)} placeholder="Café en grains" />
        </label>
        <label className="block">
          <span className="label">Rayon</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Ça dure combien de jours ?</span>
          <input className="input" type="number" min={1} required inputMode="numeric" value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="block">
          <span className="label">Dernier achat</span>
          <input className="input" type="date" required value={last} max={today()} onChange={(e) => setLast(e.target.value)} />
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full">Enregistrer</button>
        {product && <button type="button" className="btn w-full" onClick={() => save(true)}>Racheté aujourd’hui</button>}
        {product && <button type="button" className="btn w-full text-action" onClick={remove}><Icon name="trash" size={18} /> Retirer</button>}
      </form>
    </Sheet>
  );
}
