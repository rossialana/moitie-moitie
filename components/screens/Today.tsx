'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase.ts';
import { formatLong, startOfWeek, today } from '@/lib/dates.ts';
import { isRunningLow, pantryDaysLeft, weekBalance } from '@/lib/schedule.ts';
import type { TaskOccurrence } from '@/lib/types.ts';
import { useStore } from '../store';
import { Avatar, CheckButton, Empty, ErrorText, errorMessage } from '../ui';
import { Icon } from '../Icon';
import type { Tab } from '../App';

export default function Today({ goTo, openSettings }: { goTo: (tab: Tab) => void; openSettings: () => void }) {
  const { data, me, partner, memberById, patchLocal } = useStore();
  const [error, setError] = useState<string | null>(null);
  const taskById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const day = today();

  const todays = data.occurrences
    .filter((o) => o.date === day && taskById.has(o.task_id))
    .sort((a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (taskById.get(a.task_id)?.reminder_time ?? '99').localeCompare(taskById.get(b.task_id)?.reminder_time ?? '99'),
    );
  const overdue = data.occurrences.filter((o) => o.date < day && !o.completed && taskById.has(o.task_id)).sort((a, b) => a.date.localeCompare(b.date));
  const done = todays.filter((o) => o.completed).length;

  const ordered = partner ? [me, partner].sort((a, b) => a.created_at.localeCompare(b.created_at)) : [me];
  const balance = weekBalance(data.occurrences, data.members, startOfWeek(day));
  const total = ordered.reduce((n, m) => n + (balance[m.id] ?? 0), 0);

  const low = data.pantry
    .filter((p) => isRunningLow(p.last_purchased_on, p.duration_days, day))
    .map((p) => ({ p, left: pantryDaysLeft(p.last_purchased_on, p.duration_days, day) }))
    .sort((a, b) => a.left - b.left);

  async function toggle(o: TaskOccurrence) {
    const isDone = !o.completed;
    const next = { ...o, completed: isDone, completed_by: isDone ? me.id : null, completed_at: isDone ? new Date().toISOString() : null };
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

  const row = (o: TaskOccurrence, showDate = false) => {
    const task = taskById.get(o.task_id)!;
    const together = task.assignment_mode === 'together';
    const who = memberById(o.assigned_member_id);
    const by = memberById(o.completed_by);
    return (
      <li key={o.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
        <CheckButton checked={o.completed} onClick={() => toggle(o)} label={task.title} />
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${o.completed ? 'text-muted line-through' : ''}`}>{task.title}</p>
          <p className="text-sm text-muted">
            {showDate && <>{formatLong(o.date)} · </>}
            {o.completed && by ? `Fait par ${by.id === me.id ? 'toi' : by.name}` : together ? 'Ensemble' : who ? (who.id === me.id ? 'Toi' : who.name) : 'Personne'}
            {task.reminder_time && !o.completed && <> · {task.reminder_time.slice(0, 5)}</>}
          </p>
        </div>
        <Avatar member={who} together={together} />
      </li>
    );
  };

  return (
    <>
      <header className="flex items-start justify-between gap-3 pt-2">
        <div>
          <p className="font-semibold text-muted">{formatLong(day)}</p>
          <h1 className="text-[44px] leading-none">Bonjour {me.name}</h1>
        </div>
        <button className="flex size-12 shrink-0 items-center justify-center rounded-[10px] border-[3px] border-ink" onClick={openSettings} aria-label="Foyer et réglages">
          <Icon name="gear" />
        </button>
      </header>

      {partner ? (
        <section className="card-pad space-y-3" aria-label="Équilibre de la semaine">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl">Cette semaine</h2>
            <span className="text-sm text-muted">{total} tâches prévues</span>
          </div>
          <div className="flex h-5 overflow-hidden rounded-full border-[3px] border-ink" aria-hidden>
            {ordered.map((m, i) => (
              <div key={m.id} className={`person-${m.color} ${i ? 'border-l-[3px] border-ink' : ''}`} style={{ flex: total ? balance[m.id] || 0.0001 : 1 }} />
            ))}
          </div>
          <div className="flex justify-between text-sm font-semibold">
            {ordered.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-2">
                <Avatar member={m} size={22} /> {m.name} · {balance[m.id] ?? 0}
              </span>
            ))}
          </div>
        </section>
      ) : (
        <button className="card-pad flex items-center gap-3 border-dashed text-left" onClick={openSettings}>
          <Icon name="share" />
          <span>
            <strong className="block">Invite ta moitié</strong>
            <span className="text-sm text-muted">Partage le code du foyer pour commencer à deux.</span>
          </span>
        </button>
      )}

      <ErrorText>{error}</ErrorText>

      {overdue.length > 0 && (
        <section>
          <h2 className="section-title text-action">En retard</h2>
          <ul className="card divide-y-[3px] divide-ink overflow-hidden">{overdue.map((o) => row(o, true))}</ul>
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="section-title">Aujourd'hui</h2>
          {todays.length > 0 && <span className="text-sm font-semibold text-muted">{done}/{todays.length}</span>}
        </div>
        {todays.length ? (
          <ul className="card divide-y-[3px] divide-ink overflow-hidden">{todays.map((o) => row(o))}</ul>
        ) : (
          <Empty>
            {data.tasks.length ? 'Rien de prévu aujourd’hui.' : <>Aucune tâche pour l’instant. <button className="btn-link" onClick={() => goTo('tasks')}>Créer la première</button></>}
          </Empty>
        )}
      </section>

      {low.length > 0 && (
        <button className="card-pad bg-blush text-left" onClick={() => goTo('shopping')}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl">Bientôt fini</h2>
            <Icon name="arrow" />
          </div>
          <ul className="space-y-1">
            {low.map(({ p, left }) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-muted">{left <= 0 ? 'terminé' : `encore ~${left} j`}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Déjà ajouté à la liste du supermarché.</p>
        </button>
      )}
    </>
  );
}
