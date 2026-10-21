import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useStore } from '../store.tsx';
import { formatLong, today } from '../lib/dates.ts';
import { CATEGORIES, type ShoppingItem, type ShoppingList } from '../lib/types.ts';
import { Avatar, CheckButton, Empty, PageHeader, Sheet, errorMessage } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';

export default function Shopping() {
  const { data, me, memberById, patchLocal, removeLocal } = useStore();
  const [listId, setListId] = useState(data.lists[0]?.id ?? '');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [editingList, setEditingList] = useState<ShoppingList | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = data.lists.find((l) => l.id === listId) ?? data.lists[0];
  const items = list ? data.items.filter((i) => i.list_id === list.id) : [];
  const pending = items.filter((i) => !i.purchased);
  const bought = items.filter((i) => i.purchased);

  const groups = CATEGORIES.map((c) => ({ c, rows: pending.filter((i) => i.category === c) }))
    .concat([{ c: 'Autre', rows: pending.filter((i) => !CATEGORIES.includes(i.category)) }])
    .filter((g) => g.rows.length);

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
    // Acheté → on remet le compteur du garde-manger à zéro.
    if (next.purchased) {
      const product = data.pantry.find((p) => p.id === item.pantry_product_id || p.name.toLowerCase() === item.name.trim().toLowerCase());
      if (product) {
        patchLocal('pantry', { ...product, last_purchased_on: today() });
        await supabase.from('pantry_products').update({ last_purchased_on: today() }).eq('id', product.id);
      }
    }
  }

  async function clearBought() {
    const ids = bought.map((i) => i.id);
    ids.forEach((id) => removeLocal('items', id));
    const { error } = await supabase.from('shopping_items').delete().in('id', ids);
    if (error) setError(errorMessage(error));
  }

  async function removeItem(item: ShoppingItem) {
    removeLocal('items', item.id);
    const { error } = await supabase.from('shopping_items').delete().eq('id', item.id);
    if (error) {
      patchLocal('items', item);
      setError(errorMessage(error));
    }
  }

  const shopper = memberById(list?.shopper_id);

  const row = (i: ShoppingItem) => {
    const by = memberById(i.requested_by);
    return (
      <li key={i.id} className={`row ${i.purchased ? 'done' : ''}`}>
        <CheckButton checked={i.purchased} onClick={() => toggle(i)} label={i.name} color={me.color} />
        <div className="row-main">
          <span className="row-title">
            {i.name}
            {i.quantity && <span className="qty"> · {i.quantity}</span>}
            {i.is_automatic && <span className="tag">auto</span>}
          </span>
          {by && !i.purchased && <span className="row-sub">Demandé par {by.id === me.id ? 'toi' : by.name}</span>}
        </div>
        <button className="icon-btn subtle" onClick={() => removeItem(i)} aria-label={`Retirer ${i.name}`}><Icon name="close" size={18} /></button>
      </li>
    );
  };

  return (
    <div className="page">
      <PageHeader title="Courses" subtitle={list ? `${pending.length} article${pending.length > 1 ? 's' : ''} à acheter` : undefined} />

      <div className="chips scroll-x">
        {data.lists.map((l) => {
          const n = data.items.filter((i) => i.list_id === l.id && !i.purchased).length;
          return (
            <button key={l.id} className={`chip ${l.id === list?.id ? 'on' : ''}`} onClick={() => setListId(l.id)}>
              {l.name}{n > 0 && <span className="chip-count">{n}</span>}
            </button>
          );
        })}
        <button className="chip ghost" onClick={() => setEditingList('new')} aria-label="Nouvelle liste"><Icon name="plus" size={16} /></button>
      </div>

      {list && (
        <>
          <button className="card shopper" onClick={() => setEditingList(list)}>
            <Avatar member={shopper} size={32} />
            <span className="row-main">
              <span className="row-title">{shopper ? `${shopper.id === me.id ? 'Tu y vas' : `${shopper.name} y va`}` : "Personne n'y va encore"}</span>
              <span className="row-sub">{list.date ? formatLong(list.date) : 'Touche pour choisir qui y va et quand'}</span>
            </span>
          </button>

          <form className="add-item" onSubmit={add}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ajouter un article…" aria-label="Article" enterKeyHint="done" />
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qté" aria-label="Quantité" className="qty-input" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Rayon">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn primary icon-only" aria-label="Ajouter"><Icon name="plus" /></button>
          </form>
          {error && <p className="error">{error}</p>}

          {groups.length ? groups.map((g) => (
            <section key={g.c}>
              <h3 className="section-title">{g.c}</h3>
              <ul className="list">{g.rows.map(row)}</ul>
            </section>
          )) : <Empty>La liste est vide. Ajoutez ce qu'il manque au fur et à mesure 🛒</Empty>}

          {bought.length > 0 && (
            <section>
              <div className="section-row">
                <h3 className="section-title">Dans le panier</h3>
                <button className="btn link small" onClick={clearBought}>Vider</button>
              </div>
              <ul className="list">{bought.map(row)}</ul>
            </section>
          )}
        </>
      )}

      {editingList && (
        <ListForm
          list={editingList === 'new' ? null : editingList}
          onClose={() => setEditingList(null)}
          onCreated={(id) => setListId(id)}
          onDeleted={() => setListId(data.lists.find((l) => l.id !== list?.id)?.id ?? '')}
        />
      )}
    </div>
  );
}

function ListForm({ list, onClose, onCreated, onDeleted }: { list: ShoppingList | null; onClose: () => void; onCreated: (id: string) => void; onDeleted: () => void }) {
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
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Nom de la liste</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Marché du dimanche" />
        </label>
        <div className="field">
          <span>Qui y va ?</span>
          <div className="member-pick">
            {data.members.map((m) => (
              <button type="button" key={m.id} className={`${m.color} ${shopperId === m.id ? 'on' : ''}`} onClick={() => setShopperId(shopperId === m.id ? null : m.id)}>
                <Avatar member={m} size={24} /> {m.id === me.id ? 'Moi' : m.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Quand ?</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary">Enregistrer</button>
        {list && data.lists.length > 1 && <button type="button" className="btn danger ghost" onClick={remove}><Icon name="trash" size={18} /> Supprimer la liste</button>}
      </form>
    </Sheet>
  );
}
