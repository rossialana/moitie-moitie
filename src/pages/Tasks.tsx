import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useStore } from '../store.tsx';
import { today, WEEKDAYS } from '../lib/dates.ts';
import { FREQUENCY_LABELS, MODE_LABELS, type AssignmentMode, type Frequency, type Task } from '../lib/types.ts';
import { Avatar, Empty, PageHeader, Segmented, Sheet, errorMessage } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';

function describe(task: Task): string {
  const days = WEEKDAYS.filter((d) => task.weekdays.includes(d.value)).map((d) => d.long);
  let when: string = FREQUENCY_LABELS[task.frequency];
  if (task.frequency === 'monthly') when = `Tous les mois, le ${Number(task.start_date.slice(8))}`;
  else if (days.length && days.length < 7) when += ` · ${days.join(', ')}`;
  return task.reminder_time ? `${when} · ${task.reminder_time.slice(0, 5)}` : when;
}

export default function Tasks() {
  const { data, memberById } = useStore();
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const active = data.tasks.filter((t) => t.active);
  const paused = data.tasks.filter((t) => !t.active);

  const row = (t: Task) => (
    <li key={t.id} className={`row clickable ${t.active ? '' : 'done'}`} onClick={() => setEditing(t)}>
      <div className="row-main">
        <span className="row-title">{t.title}</span>
        <span className="row-sub">{describe(t)}</span>
      </div>
      {t.assignment_mode === 'together' ? (
        <Avatar together />
      ) : t.assignment_mode === 'fixed' ? (
        <Avatar member={memberById(t.fixed_member_id)} />
      ) : (
        <span className="avatars-stack" title="Chacun son tour">
          {t.rotation_order.map((id) => <Avatar key={id} member={memberById(id)} size={22} />)}
          <Icon name="refresh" size={14} />
        </span>
      )}
    </li>
  );

  return (
    <div className="page">
      <PageHeader
        title="Tâches"
        subtitle="Qui fait quoi, et quand"
        action={<button className="btn primary small" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Ajouter</button>}
      />
      {active.length ? <ul className="list">{active.map(row)}</ul> : (
        <Empty>
          Ajoutez vos tâches récurrentes : vaisselle, linge, poubelles, ménage…<br />
          L'app répartit tout seule, chacun son tour si vous voulez.
        </Empty>
      )}
      {paused.length > 0 && (
        <>
          <h3 className="section-title">En pause</h3>
          <ul className="list">{paused.map(row)}</ul>
        </>
      )}
      {editing && <TaskForm task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { data, me, partner, patchLocal, removeLocal, regenerateTaskOccurrences } = useStore();
  const [title, setTitle] = useState(task?.title ?? '');
  const [frequency, setFrequency] = useState<Frequency>(task?.frequency ?? 'weekly');
  const [weekdays, setWeekdays] = useState<number[]>(task?.weekdays ?? [new Date().getDay()]);
  const [mode, setMode] = useState<AssignmentMode>(task?.assignment_mode ?? (partner ? 'rotating' : 'fixed'));
  const [fixedId, setFixedId] = useState(task?.fixed_member_id ?? me.id);
  const [firstId, setFirstId] = useState(task?.rotation_order[0] ?? me.id);
  const [startDate, setStartDate] = useState(task?.start_date ?? today());
  const [time, setTime] = useState(task?.reminder_time?.slice(0, 5) ?? '');
  const [active, setActive] = useState(task?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (frequency !== 'daily' && frequency !== 'monthly' && !weekdays.length) {
      setError('Choisis au moins un jour.');
      return;
    }
    setBusy(true);
    setError(null);
    const others = data.members.filter((m) => m.id !== firstId).map((m) => m.id);
    const payload = {
      household_id: data.household.id,
      title: title.trim(),
      frequency,
      weekdays: frequency === 'monthly' ? [] : weekdays,
      assignment_mode: mode,
      fixed_member_id: mode === 'fixed' ? fixedId : null,
      rotation_order: mode === 'rotating' ? [firstId, ...others] : [],
      start_date: startDate,
      reminder_time: time || null,
      active,
    };
    const res = task
      ? await supabase.from('tasks').update(payload).eq('id', task.id).select().single<Task>()
      : await supabase.from('tasks').insert(payload).select().single<Task>();
    if (res.error) {
      setBusy(false);
      setError(errorMessage(res.error));
      return;
    }
    patchLocal('tasks', res.data);
    try {
      await regenerateTaskOccurrences(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    onClose();
  }

  async function remove() {
    if (!task || !confirm(`Supprimer « ${task.title} » et tout son historique ?`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) return setError(errorMessage(error));
    removeLocal('tasks', task.id);
    onClose();
  }

  return (
    <Sheet title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Quoi ?</span>
          <input required autoFocus={!task} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sortir les poubelles" />
        </label>

        <label className="field">
          <span>Fréquence</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
          </select>
        </label>

        {frequency !== 'monthly' && (
          <div className="field">
            <span>{frequency === 'daily' ? 'Quels jours ? (aucun = tous)' : 'Quels jours ?'}</span>
            <div className="weekday-pick">
              {WEEKDAYS.map((d) => (
                <button type="button" key={d.value} className={weekdays.includes(d.value) ? 'on' : ''} onClick={() => toggleDay(d.value)} aria-label={d.long} aria-pressed={weekdays.includes(d.value)}>
                  {d.short}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field">
          <span>{frequency === 'monthly' ? 'À partir du (même jour chaque mois)' : 'À partir du'}</span>
          <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <div className="field">
          <span>Qui s'en occupe ?</span>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[{ value: 'fixed', label: 'Fixe' }, { value: 'rotating', label: 'Tour à tour' }, { value: 'together', label: 'Ensemble' }]}
          />
          <small className="muted">{MODE_LABELS[mode]}</small>
        </div>

        {mode === 'fixed' && (
          <div className="member-pick">
            {data.members.map((m) => (
              <button type="button" key={m.id} className={`${m.color} ${fixedId === m.id ? 'on' : ''}`} onClick={() => setFixedId(m.id)}>
                <Avatar member={m} size={24} /> {m.id === me.id ? 'Moi' : m.name}
              </button>
            ))}
          </div>
        )}
        {mode === 'rotating' && (
          <div className="field">
            <span>Qui commence ?</span>
            <div className="member-pick">
              {data.members.map((m) => (
                <button type="button" key={m.id} className={`${m.color} ${firstId === m.id ? 'on' : ''}`} onClick={() => setFirstId(m.id)}>
                  <Avatar member={m} size={24} /> {m.id === me.id ? 'Moi' : m.name}
                </button>
              ))}
            </div>
            {!partner && <small className="muted">Ta moitié entrera dans la rotation en rejoignant le foyer.</small>}
          </div>
        )}

        <label className="field">
          <span>Heure du rappel (facultatif)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>

        {task && (
          <label className="toggle">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Tâche active</span>
          </label>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        {task && <button type="button" className="btn danger ghost" onClick={remove}><Icon name="trash" size={18} /> Supprimer</button>}
      </form>
    </Sheet>
  );
}
