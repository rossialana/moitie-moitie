import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useStore } from '../store.tsx';
import { addDays, daysBetween, formatLong, formatTime, parseISODate, startOfWeek, today, toISODate } from '../lib/dates.ts';
import { nextReminderDate, pantryDaysLeft, pantryThreshold } from '../lib/schedule.ts';
import type { TaskOccurrence } from '../lib/types.ts';
import { Avatar, CheckButton, Empty, Segmented, errorMessage } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';

type Filter = 'all' | 'mine' | 'together';

export default function Today({ goTo }: { goTo: (tab: 'tasks' | 'shopping' | 'reminders' | 'more') => void }) {
  const { data, me, partner, memberById, patchLocal } = useStore();
  const [day, setDay] = useState(today());
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const taskById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const visible = (o: TaskOccurrence) => {
    const task = taskById.get(o.task_id);
    if (!task) return false;
    if (filter === 'mine') return o.assigned_member_id === me.id || o.assigned_member_id === null;
    if (filter === 'together') return task.assignment_mode === 'together';
    return true;
  };
  const byTime = (a: TaskOccurrence, b: TaskOccurrence) =>
    Number(a.completed) - Number(b.completed) ||
    (taskById.get(a.task_id)?.reminder_time ?? '99').localeCompare(taskById.get(b.task_id)?.reminder_time ?? '99');

  const dayOccurrences = data.occurrences.filter((o) => o.date === day && visible(o)).sort(byTime);
  const overdue = day === today() ? data.occurrences.filter((o) => o.date < day && !o.completed && visible(o)).sort((a, b) => a.date.localeCompare(b.date)) : [];

  // Équilibre de la semaine (lundi → dimanche).
  const weekStart = startOfWeek(today());
  const weekDone = data.occurrences.filter((o) => o.completed && o.date >= weekStart && o.date <= addDays(weekStart, 6));
  const doneBy = (id: string) => weekDone.filter((o) => o.completed_by === id).length;
  const mine = doneBy(me.id);
  const theirs = partner ? doneBy(partner.id) : 0;
  const total = mine + theirs;

  const strip = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 1));

  async function toggle(o: TaskOccurrence) {
    const done = !o.completed;
    const next = { ...o, completed: done, completed_by: done ? me.id : null, completed_at: done ? new Date().toISOString() : null };
    patchLocal('occurrences', next);
    const { error } = await supabase
      .from('task_occurrences')
      .update({ completed: next.completed, completed_by: next.completed_by, completed_at: next.completed_at })
      .eq('id', o.id);
    if (error) {
      patchLocal('occurrences', o);
      setError(errorMessage(error));
    }
  }

  async function swap(o: TaskOccurrence) {
    if (!partner) return;
    const to = o.assigned_member_id === me.id ? partner.id : me.id;
    patchLocal('occurrences', { ...o, assigned_member_id: to });
    const { error } = await supabase.from('task_occurrences').update({ assigned_member_id: to }).eq('id', o.id);
    if (error) {
      patchLocal('occurrences', o);
      setError(errorMessage(error));
    }
  }

  // Rappels proches : dans la fenêtre de préavis (au moins 3 jours) ou aujourd'hui.
  const now = new Date();
  const upcoming = data.reminders
    .map((r) => ({ r, next: nextReminderDate(r, now) }))
    .filter(({ r, next }) => {
      const days = daysBetween(today(), toISODate(next));
      return days >= 0 && days <= Math.max(3, r.notice_days);
    })
    .sort((a, b) => a.next.getTime() - b.next.getTime());

  const lowPantry = data.pantry
    .map((p) => ({ p, left: pantryDaysLeft(p.last_purchased_on, p.duration_days, today()) }))
    .filter(({ p, left }) => left <= pantryThreshold(p.duration_days))
    .sort((a, b) => a.left - b.left);

  const renderRow = (o: TaskOccurrence, showDate = false) => {
    const task = taskById.get(o.task_id)!;
    const together = task.assignment_mode === 'together';
    const who = memberById(o.assigned_member_id);
    const doneBy = memberById(o.completed_by);
    return (
      <li key={o.id} className={`row ${o.completed ? 'done' : ''}`}>
        <CheckButton checked={o.completed} onClick={() => toggle(o)} label={task.title} color={doneBy?.color ?? me.color} />
        <div className="row-main">
          <span className="row-title">{task.title}</span>
          <span className="row-sub">
            {showDate && <>{formatLong(o.date)} · </>}
            {o.completed && doneBy ? `Fait par ${doneBy.id === me.id ? 'toi' : doneBy.name}` : together ? 'Ensemble' : who ? (who.id === me.id ? 'Toi' : who.name) : 'Personne'}
            {task.reminder_time && !o.completed && <> · {task.reminder_time.slice(0, 5)}</>}
          </span>
        </div>
        {!together && partner && !o.completed && (
          <button className="icon-btn subtle" onClick={() => swap(o)} aria-label="Échanger avec l'autre personne" title="Échanger">
            <Icon name="swap" size={18} />
          </button>
        )}
        <Avatar member={who} together={together} />
      </li>
    );
  };

  const hour = now.getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="muted">{formatLong(today())}</p>
          <h1>{hello} {me.name} 👋</h1>
        </div>
      </header>

      {partner ? (
        <section className="card balance">
          <div className="balance-head">
            <span>Cette semaine</span>
            <span className="muted small">{total} tâche{total > 1 ? 's' : ''} faite{total > 1 ? 's' : ''}</span>
          </div>
          <div className="balance-bar" aria-hidden="true">
            <div className={me.color} style={{ flex: total ? mine : 1 }} />
            <div className={partner.color} style={{ flex: total ? theirs : 1 }} />
          </div>
          <div className="balance-legend">
            <span><Avatar member={me} size={20} /> Toi · {mine}</span>
            <span>{partner.name} · {theirs} <Avatar member={partner} size={20} /></span>
          </div>
        </section>
      ) : (
        <button className="card invite-cta" onClick={() => goTo('more')}>
          <Icon name="users" />
          <span><strong>Invite ta moitié</strong><br /><span className="muted small">Partage le code du foyer depuis « Plus ».</span></span>
        </button>
      )}

      <div className="daystrip" role="tablist">
        {strip.map((d) => {
          const date = parseISODate(d);
          const count = data.occurrences.filter((o) => o.date === d && !o.completed).length;
          return (
            <button key={d} role="tab" aria-selected={d === day} className={`${d === day ? 'on' : ''} ${d === today() ? 'is-today' : ''}`} onClick={() => setDay(d)}>
              <span className="small">{new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date).replace('.', '')}</span>
              <strong>{date.getDate()}</strong>
              <span className={`dot ${count ? '' : 'hidden'}`} />
            </button>
          );
        })}
      </div>

      <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Tout' }, { value: 'mine', label: 'Pour moi' }, { value: 'together', label: 'Ensemble' }]} />
      {error && <p className="error">{error}</p>}

      {overdue.length > 0 && (
        <section>
          <h3 className="section-title warn">En retard</h3>
          <ul className="list">{overdue.map((o) => renderRow(o, true))}</ul>
        </section>
      )}

      <section>
        <h3 className="section-title">{day === today() ? "Aujourd'hui" : formatLong(day)}</h3>
        {dayOccurrences.length ? (
          <ul className="list">{dayOccurrences.map((o) => renderRow(o))}</ul>
        ) : (
          <Empty>
            {data.tasks.length ? 'Rien de prévu ce jour-là. Profitez-en ✨' : <>Aucune tâche pour l'instant. <button className="btn link" onClick={() => goTo('tasks')}>Créer la première</button></>}
          </Empty>
        )}
      </section>

      {upcoming.length > 0 && (
        <section>
          <h3 className="section-title">À venir</h3>
          <ul className="list">
            {upcoming.map(({ r, next }) => (
              <li key={r.id} className="row" onClick={() => goTo('reminders')}>
                <span className="row-icon"><Icon name="bell" size={18} /></span>
                <div className="row-main">
                  <span className="row-title">{r.title}</span>
                  <span className="row-sub">{formatLong(toISODate(next))} · {formatTime(next)}</span>
                </div>
                <Avatar member={memberById(r.assigned_member_id)} together={!r.assigned_member_id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {lowPantry.length > 0 && (
        <section>
          <h3 className="section-title">Bientôt fini</h3>
          <ul className="list">
            {lowPantry.map(({ p, left }) => (
              <li key={p.id} className="row" onClick={() => goTo('shopping')}>
                <span className="row-icon"><Icon name="jar" size={18} /></span>
                <div className="row-main">
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub">{left <= 0 ? 'Probablement terminé' : `Encore ~${left} jour${left > 1 ? 's' : ''}`} · ajouté aux courses</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
