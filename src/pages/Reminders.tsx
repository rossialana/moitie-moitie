import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useStore } from '../store.tsx';
import { formatLong, formatTime, relativeDay, toISODate } from '../lib/dates.ts';
import { nextReminderDate } from '../lib/schedule.ts';
import { REPEAT_LABELS, type Reminder, type Repeat } from '../lib/types.ts';
import { Avatar, Empty, PageHeader, Sheet, errorMessage } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';

/** Date → valeur pour <input type="datetime-local"> (heure locale). */
function toLocalInput(d: Date): string {
  return `${toISODate(d)}T${d.toTimeString().slice(0, 5)}`;
}

export default function Reminders() {
  const { data, memberById } = useStore();
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const now = new Date();

  const all = data.reminders.map((r) => ({ r, next: nextReminderDate(r, now) })).sort((a, b) => a.next.getTime() - b.next.getTime());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = all.filter(({ next }) => next >= startOfToday);
  const past = all.filter(({ next }) => next < startOfToday).reverse();

  const row = ({ r, next }: { r: Reminder; next: Date }) => {
    const who = memberById(r.assigned_member_id);
    return (
      <li key={r.id} className={`row clickable ${next < startOfToday ? 'done' : ''}`} onClick={() => setEditing(r)}>
        <div className="date-tile">
          <strong>{next.getDate()}</strong>
          <span>{new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(next).replace('.', '')}</span>
        </div>
        <div className="row-main">
          <span className="row-title">{r.title}</span>
          <span className="row-sub">
            {relativeDay(toISODate(next))} · {formatTime(next)}
            {r.repeat !== 'none' && <> · {REPEAT_LABELS[r.repeat].toLowerCase()}</>}
            {r.notice_days > 0 && <> · prévenir {r.notice_days} j avant</>}
          </span>
          {r.note && <span className="row-note">{r.note}</span>}
        </div>
        {r.assigned_member_id ? <Avatar member={who} /> : <Avatar together />}
      </li>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Rappels"
        subtitle="Anniversaires, rendez-vous, factures…"
        action={<button className="btn primary small" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Ajouter</button>}
      />
      {upcoming.length ? <ul className="list">{upcoming.map(row)}</ul> : <Empty>Aucun rappel à venir. Ajoutez les anniversaires, le contrôle technique, la vaccination du chat…</Empty>}
      {past.length > 0 && (
        <>
          <h3 className="section-title">Passés</h3>
          <ul className="list">{past.map(row)}</ul>
        </>
      )}
      {editing && <ReminderForm reminder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReminderForm({ reminder, onClose }: { reminder: Reminder | null; onClose: () => void }) {
  const { data, me, patchLocal, removeLocal } = useStore();
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 1);
  defaultDate.setHours(9, 0, 0, 0);

  const [title, setTitle] = useState(reminder?.title ?? '');
  const [when, setWhen] = useState(toLocalInput(reminder ? new Date(reminder.due_at) : defaultDate));
  const [assignee, setAssignee] = useState<string | null>(reminder ? reminder.assigned_member_id : null);
  const [repeat, setRepeat] = useState<Repeat>(reminder?.repeat ?? 'none');
  const [notice, setNotice] = useState(reminder?.notice_days ?? 0);
  const [note, setNote] = useState(reminder?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = {
      household_id: data.household.id,
      title: title.trim(),
      due_at: new Date(when).toISOString(),
      assigned_member_id: assignee,
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
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Quoi ?</span>
          <input required autoFocus={!reminder} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Anniversaire de maman" />
        </label>
        <label className="field">
          <span>Date et heure</span>
          <input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <div className="field">
          <span>Pour qui ?</span>
          <div className="member-pick">
            <button type="button" className={`together ${assignee === null ? 'on' : ''}`} onClick={() => setAssignee(null)}>
              <Avatar together size={24} /> Les deux
            </button>
            {data.members.map((m) => (
              <button type="button" key={m.id} className={`${m.color} ${assignee === m.id ? 'on' : ''}`} onClick={() => setAssignee(m.id)}>
                <Avatar member={m} size={24} /> {m.id === me.id ? 'Moi' : m.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Répétition</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Prévenir combien de jours avant ?</span>
          <input type="number" min={0} max={60} inputMode="numeric" value={notice} onChange={(e) => setNotice(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="field">
          <span>Note</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Idée cadeau, adresse, numéro de dossier…" />
        </label>
        {error && <p className="error">{error}</p>}
        {!Number.isNaN(new Date(when).getTime()) && (
          <p className="muted small">Prochaine fois : {formatLong(toISODate(nextReminderDate({ due_at: new Date(when).toISOString(), repeat })))}</p>
        )}
        <button className="btn primary">Enregistrer</button>
        {reminder && <button type="button" className="btn danger ghost" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>}
      </form>
    </Sheet>
  );
}
