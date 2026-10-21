'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase.ts';
import { formatLong, formatTime, relativeDay, toISODate } from '@/lib/dates.ts';
import { nextReminderDate } from '@/lib/schedule.ts';
import { REPEAT_LABELS, type Note, type Reminder, type Repeat } from '@/lib/types.ts';
import { useStore } from '../store';
import { AddButton, Avatar, Empty, ErrorText, PageTitle, Segmented, Sheet, errorMessage } from '../ui';
import { Icon } from '../Icon';

/** Date → valeur pour <input type="datetime-local"> (heure locale). */
function toLocalInput(d: Date): string {
  return `${toISODate(d)}T${d.toTimeString().slice(0, 5)}`;
}

const month = (d: Date) => new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(d).replace('.', '');

export default function Reminders() {
  const { data, me, memberById } = useStore();
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const [note, setNote] = useState<Note | 'new' | null>(null);
  const [showPast, setShowPast] = useState(false);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const all = data.reminders.map((r) => ({ r, next: nextReminderDate(r, now) })).sort((a, b) => a.next.getTime() - b.next.getTime());
  const upcoming = all.filter(({ next }) => next >= startOfToday);
  const past = all.filter(({ next }) => next < startOfToday).reverse();
  const [first, ...rest] = upcoming;

  const forWhom = (r: Reminder) => {
    const m = memberById(r.assigned_member_id);
    return !r.assigned_member_id ? 'Pour vous deux' : m?.id === me.id ? 'Pour toi' : `Pour ${m?.name ?? '—'}`;
  };

  const row = ({ r, next }: { r: Reminder; next: Date }) => (
    <li key={r.id}>
      <button className={`flex w-full items-center gap-4 px-4 py-3 text-left ${next < startOfToday ? 'opacity-50' : ''}`} onClick={() => setEditing(r)}>
        <span className="w-12 shrink-0 text-center">
          <span className="block font-display text-4xl leading-none">{next.getDate()}</span>
          <span className="block font-display text-sm uppercase">{month(next)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{r.title}</span>
          <span className="block text-sm text-muted">
            {relativeDay(toISODate(next))} · {formatTime(next)}
            {r.repeat !== 'none' && <> · {REPEAT_LABELS[r.repeat].toLowerCase()}</>}
          </span>
        </span>
        {r.assigned_member_id ? <Avatar member={memberById(r.assigned_member_id)} /> : <Avatar together />}
      </button>
    </li>
  );

  return (
    <>
      <PageTitle title="Rappels" subtitle="Anniversaires, rendez-vous, factures" action={<AddButton onClick={() => setEditing('new')} label="Nouveau rappel" />} />

      {first ? (
        <button className="card w-full bg-ink p-5 text-left text-cream" onClick={() => setEditing(first.r)}>
          <span className="pill bg-rose text-ink">Prochain · {relativeDay(toISODate(first.next))}</span>
          <span className="mt-3 flex items-end gap-4">
            <span className="text-center">
              <span className="block font-display text-6xl leading-none">{first.next.getDate()}</span>
              <span className="block font-display text-lg uppercase">{month(first.next)}</span>
            </span>
            <span className="min-w-0 pb-1">
              <span className="block font-display text-3xl leading-tight uppercase">{first.r.title}</span>
              <span className="block text-sm text-rose">{formatTime(first.next)} · {forWhom(first.r)}</span>
            </span>
          </span>
          {first.r.note && <span className="mt-3 block border-t-2 border-rose pt-3 text-sm">{first.r.note}</span>}
        </button>
      ) : (
        <Empty>Aucun rappel à venir. Anniversaires, contrôle technique, vaccin du chat…</Empty>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="section-title">À venir</h2>
          <ul className="card divide-y-[3px] divide-ink overflow-hidden">{rest.map(row)}</ul>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <button className="btn-link text-sm" onClick={() => setShowPast((v) => !v)}>{showPast ? 'Masquer' : 'Voir'} les rappels passés ({past.length})</button>
          {showPast && <ul className="card mt-2 divide-y-[3px] divide-ink overflow-hidden">{past.map(row)}</ul>}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="section-title">Notes de la maison</h2>
          <button className="btn btn-small" onClick={() => setNote('new')}><Icon name="plus" size={16} /> Note</button>
        </div>
        {data.notes.length ? (
          <div className="grid grid-cols-2 gap-3">
            {[...data.notes].sort((a, b) => a.title.localeCompare(b.title)).map((n) => (
              <button key={n.id} className="card flex min-h-32 flex-col gap-1 p-3 text-left" onClick={() => setNote(n)}>
                <span className="font-display text-lg uppercase">{n.title || 'Sans titre'}</span>
                <span className="line-clamp-4 text-sm whitespace-pre-wrap text-muted">{n.content}</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty>Le wifi, les mesures des fenêtres, les numéros utiles…</Empty>
        )}
      </section>

      {editing && <ReminderSheet reminder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {note && <NoteSheet note={note === 'new' ? null : data.notes.find((n) => n.id === note.id) ?? null} isNew={note === 'new'} onClose={() => setNote(null)} />}
    </>
  );
}

function ReminderSheet({ reminder, onClose }: { reminder: Reminder | null; onClose: () => void }) {
  const { data, me, patchLocal, removeLocal } = useStore();
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 1);
  defaultDate.setHours(9, 0, 0, 0);

  const [title, setTitle] = useState(reminder?.title ?? '');
  const [when, setWhen] = useState(toLocalInput(reminder ? new Date(reminder.due_at) : defaultDate));
  const [assignee, setAssignee] = useState<string>(reminder?.assigned_member_id ?? 'both');
  const [repeat, setRepeat] = useState<Repeat>(reminder?.repeat ?? 'none');
  const [notice, setNotice] = useState(reminder?.notice_days ?? 1);
  const [note, setNote] = useState(reminder?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const valid = !Number.isNaN(new Date(when).getTime());

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = {
      household_id: data.household.id,
      title: title.trim(),
      due_at: new Date(when).toISOString(),
      assigned_member_id: assignee === 'both' ? null : assignee,
      repeat,
      notice_days: notice,
      note: note.trim() || null,
    };
    const res = reminder
      ? await supabase.from('reminders').update(payload).eq('id', reminder.id).select().single<Reminder>()
      : await supabase.from('reminders').insert(payload).select().single<Reminder>();
    if (res.error) return setError(errorMessage(res.error));
    patchLocal('reminders', res.data);
    onClose();
  }

  async function remove() {
    if (!reminder || !confirm(`Supprimer « ${reminder.title} » ?`)) return;
    const { error } = await supabase.from('reminders').delete().eq('id', reminder.id);
    if (error) return setError(errorMessage(error));
    removeLocal('reminders', reminder.id);
    onClose();
  }

  return (
    <Sheet title={reminder ? 'Modifier le rappel' : 'Nouveau rappel'} onClose={onClose}>
      <form className="space-y-5" onSubmit={save}>
        <label className="block">
          <span className="label">Quoi ?</span>
          <input className="input" required autoFocus={!reminder} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Anniversaire de maman" />
        </label>
        <label className="block">
          <span className="label">Date et heure</span>
          <input className="input" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <div>
          <span className="label">Pour qui ?</span>
          <Segmented
            value={assignee}
            onChange={setAssignee}
            options={[{ value: 'both', label: 'Les deux' }, ...data.members.map((m) => ({ value: m.id, label: m.id === me.id ? 'Moi' : m.name }))]}
          />
        </div>
        <div>
          <span className="label">Répétition</span>
          <Segmented value={repeat} onChange={setRepeat} options={(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => ({ value: r, label: REPEAT_LABELS[r] }))} />
        </div>
        <label className="block">
          <span className="label">Prévenir combien de jours avant ?</span>
          <input className="input" type="number" min={0} max={60} inputMode="numeric" value={notice} onChange={(e) => setNotice(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="block">
          <span className="label">Note</span>
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Idée cadeau, adresse, numéro de dossier…" />
        </label>
        {valid && <p className="text-sm text-muted">Prochaine fois : {formatLong(toISODate(nextReminderDate({ due_at: new Date(when).toISOString(), repeat })))}</p>}
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full">Enregistrer <Icon name="arrow" size={18} /></button>
        {reminder && <button type="button" className="btn w-full text-action" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>}
      </form>
    </Sheet>
  );
}

function NoteSheet({ note, isNew, onClose }: { note: Note | null; isNew: boolean; onClose: () => void }) {
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
  }, [note?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!dirty.current || (isNew && !title.trim() && !content.trim())) return onClose();
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
    <Sheet title={isNew ? 'Nouvelle note' : 'Note'} onClose={save}>
      <div className="space-y-4">
        <input className="input font-display text-xl uppercase" value={title} onChange={(e) => { dirty.current = true; setTitle(e.target.value); }} placeholder="Titre" aria-label="Titre" />
        <textarea className="input min-h-60" value={content} onChange={(e) => { dirty.current = true; setContent(e.target.value); }} placeholder="Écris ici…" aria-label="Contenu" autoFocus={isNew} />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" onClick={save}>Enregistrer</button>
        {note && <button className="btn w-full text-action" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>}
      </div>
    </Sheet>
  );
}
