import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useStore } from '../store.tsx';
import { formatShort, relativeDay, today } from '../lib/dates.ts';
import { pantryDaysLeft, pantryThreshold } from '../lib/schedule.ts';
import { CATEGORIES, type Note, type PantryProduct } from '../lib/types.ts';
import { Avatar, Empty, PageHeader, Sheet, errorMessage } from '../components/ui.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';

type Section = 'pantry' | 'notes' | 'household';
const SECTIONS: { id: Section; label: string; hint: string; icon: IconName }[] = [
  { id: 'pantry', label: 'Garde-manger', hint: 'Ce qui va bientôt manquer', icon: 'jar' },
  { id: 'notes', label: 'Notes', hint: 'Codes wifi, idées, infos utiles', icon: 'note' },
  { id: 'household', label: 'Foyer', hint: 'Invitation, profil, notifications', icon: 'users' },
];

export default function More({ onLeft }: { onLeft: () => void }) {
  const [section, setSection] = useState<Section | null>(null);
  const back = <button className="btn link back" onClick={() => setSection(null)}><Icon name="back" size={18} /> Plus</button>;

  if (section === 'pantry') return <div className="page">{back}<Pantry /></div>;
  if (section === 'notes') return <div className="page">{back}<Notes /></div>;
  if (section === 'household') return <div className="page">{back}<HouseholdSettings onLeft={onLeft} /></div>;

  return (
    <div className="page">
      <PageHeader title="Plus" />
      <ul className="list">
        {SECTIONS.map((s) => (
          <li key={s.id} className="row clickable" onClick={() => setSection(s.id)}>
            <span className="row-icon"><Icon name={s.icon} size={20} /></span>
            <div className="row-main">
              <span className="row-title">{s.label}</span>
              <span className="row-sub">{s.hint}</span>
            </div>
            <span className="chevron">›</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────── Garde-manger ─────────────

function Pantry() {
  const { data } = useStore();
  const [editing, setEditing] = useState<PantryProduct | 'new' | null>(null);
  const rows = data.pantry
    .map((p) => ({ p, left: pantryDaysLeft(p.last_purchased_on, p.duration_days, today()) }))
    .sort((a, b) => a.left - b.left);

  return (
    <>
      <PageHeader
        title="Garde-manger"
        subtitle="Quand un produit arrive à sa fin, il s'ajoute tout seul aux courses."
        action={<button className="btn primary small" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Ajouter</button>}
      />
      {rows.length ? (
        <ul className="list">
          {rows.map(({ p, left }) => {
            const ratio = Math.max(0, Math.min(1, left / p.duration_days));
            const low = left <= pantryThreshold(p.duration_days);
            return (
              <li key={p.id} className="row clickable pantry-row" onClick={() => setEditing(p)}>
                <div className="row-main">
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub">
                    {left <= 0 ? 'Probablement terminé' : `Encore ~${left} jour${left > 1 ? 's' : ''}`} · acheté {relativeDay(p.last_purchased_on).toLowerCase()}
                  </span>
                  <div className="meter"><div className={low ? 'low' : ''} style={{ width: `${ratio * 100}%` }} /></div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Ajoutez les produits que vous rachetez régulièrement (café, lessive, papier toilette…) avec leur durée habituelle.</Empty>
      )}
      {editing && <PantryForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PantryForm({ product, onClose }: { product: PantryProduct | null; onClose: () => void }) {
  const { data, patchLocal, removeLocal } = useStore();
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category ?? CATEGORIES[0]);
  const [duration, setDuration] = useState(product?.duration_days ?? 14);
  const [last, setLast] = useState(product?.last_purchased_on ?? today());
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent, boughtToday = false) {
    e.preventDefault();
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
      <form className="form" onSubmit={(e) => save(e)}>
        <label className="field">
          <span>Produit</span>
          <input required autoFocus={!product} value={name} onChange={(e) => setName(e.target.value)} placeholder="Café en grains" />
        </label>
        <label className="field">
          <span>Rayon</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Ça dure combien de jours ?</span>
          <input type="number" min={1} required inputMode="numeric" value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <label className="field">
          <span>Dernier achat</span>
          <input type="date" required value={last} max={today()} onChange={(e) => setLast(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary">Enregistrer</button>
        {product && <button type="button" className="btn ghost" onClick={(e) => save(e, true)}>Racheté aujourd'hui</button>}
        {product && <button type="button" className="btn danger ghost" onClick={remove}><Icon name="trash" size={18} /> Retirer</button>}
      </form>
    </Sheet>
  );
}

// ───────────── Notes ─────────────

function Notes() {
  const { data } = useStore();
  const [openId, setOpenId] = useState<string | 'new' | null>(null);
  const note = data.notes.find((n) => n.id === openId) ?? null;
  const sorted = [...data.notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle="Partagées entre vous deux"
        action={<button className="btn primary small" onClick={() => setOpenId('new')}><Icon name="plus" size={18} /> Nouvelle</button>}
      />
      {sorted.length ? (
        <div className="notes-grid">
          {sorted.map((n) => (
            <button key={n.id} className="note-card" onClick={() => setOpenId(n.id)}>
              <strong>{n.title || 'Sans titre'}</strong>
              <span>{n.content.slice(0, 140)}</span>
              <small className="muted">{formatShort(n.updated_at.slice(0, 10))}</small>
            </button>
          ))}
        </div>
      ) : (
        <Empty>Le code du wifi, la taille de chaussures des enfants, les idées de vacances…</Empty>
      )}
      {openId && <NoteEditor note={openId === 'new' ? null : note} onClose={() => setOpenId(null)} />}
    </>
  );
}

function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const { data, patchLocal, removeLocal } = useStore();
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  // Si l'autre personne modifie la note pendant qu'on la lit (sans rien taper), on affiche sa version.
  useEffect(() => {
    if (note && !dirty.current) {
      setTitle(note.title);
      setContent(note.content);
    }
  }, [note?.updated_at]);

  async function save() {
    if (!dirty.current) return onClose();
    if (!note && !title.trim() && !content.trim()) return onClose();
    const payload = { household_id: data.household.id, title: title.trim(), content, updated_at: new Date().toISOString() };
    const res = note
      ? await supabase.from('notes').update(payload).eq('id', note.id).select().single<Note>()
      : await supabase.from('notes').insert(payload).select().single<Note>();
    if (res.error) return setError(errorMessage(res.error));
    patchLocal('notes', res.data);
    onClose();
  }

  async function remove() {
    if (!note || !confirm('Supprimer cette note ?')) return;
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) return setError(errorMessage(error));
    removeLocal('notes', note.id);
    onClose();
  }

  return (
    <Sheet title={note ? 'Note' : 'Nouvelle note'} onClose={save}>
      <div className="form">
        <input className="note-title" value={title} onChange={(e) => { dirty.current = true; setTitle(e.target.value); }} placeholder="Titre" aria-label="Titre" />
        <textarea className="note-body" rows={12} value={content} onChange={(e) => { dirty.current = true; setContent(e.target.value); }} placeholder="Écris ici…" aria-label="Contenu" autoFocus={!note} />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" onClick={save}>Enregistrer</button>
        {note && <button className="btn danger ghost" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>}
      </div>
    </Sheet>
  );
}

// ───────────── Foyer ─────────────

function HouseholdSettings({ onLeft }: { onLeft: () => void }) {
  const { data, me, partner, patchLocal } = useStore();
  const [name, setName] = useState(me.name);
  const [householdName, setHouseholdName] = useState(data.household.name);
  const [copied, setCopied] = useState(false);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [error, setError] = useState<string | null>(null);

  const link = `${location.origin}/?invite=${data.household.invite_code}`;
  const shareText = `Rejoins notre foyer sur Moitié-Moitié 🏡 Code : ${data.household.invite_code}`;

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Moitié-Moitié', text: shareText, url: link });
      } catch { /* partage annulé */ }
      return;
    }
    await navigator.clipboard?.writeText(`${shareText}\n${link}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const [m, h] = await Promise.all([
      supabase.from('members').update({ name: name.trim() }).eq('id', me.id).select().single(),
      supabase.from('households').update({ name: householdName.trim() }).eq('id', data.household.id),
    ]);
    const err = m.error ?? h.error;
    if (err) return setError(errorMessage(err));
    patchLocal('members', m.data);
  }

  async function newCode() {
    if (!confirm("Générer un nouveau code ? L'ancien lien ne marchera plus.")) return;
    const { error } = await supabase.rpc('regenerate_invite_code', { p_household: data.household.id });
    if (error) setError(errorMessage(error));
  }

  async function askNotifications() {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  }

  async function leave() {
    if (!confirm('Quitter ce foyer ? Tu ne verras plus ses tâches, courses et rappels.')) return;
    const { error } = await supabase.from('members').delete().eq('id', me.id);
    if (error) return setError(errorMessage(error));
    onLeft();
  }

  return (
    <>
      <PageHeader title="Foyer" subtitle={data.household.name} />

      <section className="card">
        <h3>Vous deux</h3>
        <div className="members">
          {data.members.map((m) => (
            <div key={m.id} className="member"><Avatar member={m} size={40} /><span>{m.id === me.id ? `${m.name} (toi)` : m.name}</span></div>
          ))}
          {!partner && <div className="member pending"><Avatar size={40} /><span className="muted">En attente…</span></div>}
        </div>
      </section>

      <section className="card">
        <h3>Inviter ta moitié</h3>
        <p className="muted small">Envoie ce lien. Elle ou il se connecte avec son e-mail et arrive directement dans votre foyer.</p>
        <div className="invite-code">{data.household.invite_code}</div>
        <button className="btn primary" onClick={share}><Icon name={copied ? 'check' : 'share'} size={18} /> {copied ? 'Lien copié !' : 'Partager le lien'}</button>
        <button className="btn link small" onClick={newCode}>Générer un nouveau code</button>
      </section>

      <form className="card form" onSubmit={saveProfile}>
        <h3>Profil</h3>
        <label className="field"><span>Ton prénom</span><input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Nom du foyer</span><input required value={householdName} onChange={(e) => setHouseholdName(e.target.value)} /></label>
        <button className="btn ghost">Enregistrer</button>
      </form>

      <section className="card">
        <h3>Notifications</h3>
        {perm === 'granted' ? (
          <p className="muted small">Activées sur cet appareil ✓ Tu seras prévenu·e à l'heure des tâches et des rappels.</p>
        ) : perm === 'denied' ? (
          <p className="muted small">Bloquées. Autorise-les dans les réglages du navigateur pour ce site.</p>
        ) : perm === 'unsupported' ? (
          <p className="muted small">Sur iPhone, ajoute d'abord l'app à l'écran d'accueil (Partager → « Sur l'écran d'accueil »).</p>
        ) : (
          <button className="btn ghost" onClick={askNotifications}><Icon name="bell" size={18} /> Activer les notifications</button>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
      <button className="btn danger link" onClick={leave}>Quitter le foyer</button>
    </>
  );
}
