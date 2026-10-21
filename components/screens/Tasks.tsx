'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase.ts';
import { addDays, formatShort, today, weekdayLong, WEEKDAYS } from '@/lib/dates.ts';
import { planOccurrences } from '@/lib/schedule.ts';
import { FREQUENCY_LABELS, type AssignmentMode, type Frequency, type Task } from '@/lib/types.ts';
import { useStore } from '../store';
import { AddButton, Avatar, Empty, ErrorText, PageTitle, Segmented, Sheet, Switch, errorMessage } from '../ui';
import { Icon } from '../Icon';

type Filter = 'all' | 'mine' | 'theirs' | 'rotating';
const FREQ_ORDER: Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];

function describe(task: Task): string {
  if (task.frequency === 'monthly') return `Le ${Number(task.start_date.slice(8))} du mois`;
  const days = WEEKDAYS.filter((d) => task.weekdays.includes(d.value)).map((d) => d.long);
  const when = task.frequency === 'daily' && (!days.length || days.length === 7) ? 'Tous les jours' : days.join(', ');
  return task.reminder_time ? `${when} · ${task.reminder_time.slice(0, 5)}` : when;
}

export default function Tasks() {
  const { data, me, partner, memberById } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);

  const visible = data.tasks.filter((t) => {
    if (filter === 'mine') return (t.assignment_mode === 'fixed' && t.fixed_member_id === me.id) || t.assignment_mode === 'together';
    if (filter === 'theirs') return (t.assignment_mode === 'fixed' && t.fixed_member_id === partner?.id) || t.assignment_mode === 'together';
    if (filter === 'rotating') return t.assignment_mode === 'rotating';
    return true;
  });

  const options: { value: Filter; label: string }[] = [
    { value: 'all', label: 'Toutes' },
    { value: 'mine', label: 'Les miennes' },
    ...(partner ? [{ value: 'theirs' as Filter, label: `Celles de ${partner.name}` }] : []),
    { value: 'rotating', label: 'Tour à tour' },
  ];

  return (
    <>
      <PageTitle title="Tâches" subtitle="Qui fait quoi, et quand" action={<AddButton onClick={() => setEditing('new')} label="Nouvelle tâche" />} />
      <Segmented value={filter} onChange={setFilter} options={options} />

      {data.tasks.length === 0 ? (
        <Empty>Ajoutez vos tâches récurrentes : vaisselle, linge, poubelles… L’app les répartit toute seule.</Empty>
      ) : visible.length === 0 ? (
        <Empty>Aucune tâche dans ce filtre.</Empty>
      ) : (
        FREQ_ORDER.map((f) => {
          const group = visible.filter((t) => t.frequency === f);
          if (!group.length) return null;
          return (
            <section key={f}>
              <h2 className="section-title">{FREQUENCY_LABELS[f]}</h2>
              <ul className="card divide-y-[3px] divide-ink overflow-hidden">
                {group.map((t) => (
                  <li key={t.id}>
                    <button className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left ${t.active ? '' : 'opacity-50'}`} onClick={() => setEditing(t)}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          {t.title}
                          {t.assignment_mode === 'rotating' && <span className="tag">Tour à tour</span>}
                          {!t.active && <span className="tag bg-cream">En pause</span>}
                        </p>
                        <p className="text-sm text-muted first-letter:uppercase">{describe(t)}</p>
                      </div>
                      {t.assignment_mode === 'together' ? (
                        <Avatar together />
                      ) : t.assignment_mode === 'fixed' ? (
                        <Avatar member={memberById(t.fixed_member_id)} />
                      ) : (
                        <span className="flex items-center -space-x-2">
                          {t.rotation_order.map((id) => <Avatar key={id} member={memberById(id)} size={26} />)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {editing && <TaskSheet task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type Who = string | 'rotating' | 'together'; // id de membre, ou mode

function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { data, me, partner, patchLocal, removeLocal, regenerateTaskOccurrences, memberById } = useStore();
  const ordered = partner ? [me, partner].sort((a, b) => a.created_at.localeCompare(b.created_at)) : [me];

  const initialWho: Who = !task ? (partner ? 'rotating' : me.id) : task.assignment_mode === 'fixed' ? task.fixed_member_id ?? me.id : task.assignment_mode;
  const [title, setTitle] = useState(task?.title ?? '');
  const [who, setWho] = useState<Who>(initialWho);
  const [order, setOrder] = useState<string[]>(task?.rotation_order.length ? task.rotation_order : ordered.map((m) => m.id));
  const [frequency, setFrequency] = useState<Frequency>(task?.frequency ?? 'weekly');
  const [weekdays, setWeekdays] = useState<number[]>(task?.weekdays ?? [new Date().getDay()]);
  const [startDate, setStartDate] = useState(task?.start_date ?? today());
  const [remind, setRemind] = useState(Boolean(task?.reminder_time));
  const [time, setTime] = useState(task?.reminder_time?.slice(0, 5) ?? '19:00');
  const [active, setActive] = useState(task?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode: AssignmentMode = who === 'rotating' ? 'rotating' : who === 'together' ? 'together' : 'fixed';
  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
  const needsDays = frequency === 'weekly' || frequency === 'biweekly';

  const draft = {
    id: task?.id ?? 'draft',
    household_id: data.household.id,
    active: true,
    title,
    frequency,
    weekdays: frequency === 'monthly' ? [] : weekdays,
    assignment_mode: mode,
    fixed_member_id: mode === 'fixed' ? who : null,
    rotation_order: mode === 'rotating' ? order : [],
    start_date: startDate,
  };

  // Aperçu des 4 prochains tours (en tenant compte de l'historique de la tâche).
  const preview = useMemo(() => {
    if (needsDays && !weekdays.length) return [];
    const from = startDate > today() ? startDate : today();
    const past = task ? data.occurrences.filter((o) => o.task_id === task.id && o.date < from) : [];
    return planOccurrences([draft], data.members.map((m) => m.id), past, from, addDays(from, 400)).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, weekdays.join(), mode, who, order.join(), startDate, data.members.length]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (needsDays && !weekdays.length) return setError('Choisis au moins un jour.');
    setBusy(true);
    setError(null);
    const { id: _id, active: _a, ...rest } = draft;
    const payload = { ...rest, title: title.trim(), reminder_time: remind ? time : null, active };
    const res = task
      ? await supabase.from('tasks').update(payload).eq('id', task.id).select().single<Task>()
      : await supabase.from('tasks').insert(payload).select().single<Task>();
    if (res.error) {
      setBusy(false);
      return setError(errorMessage(res.error));
    }
    patchLocal('tasks', res.data);
    try {
      await regenerateTaskOccurrences(res.data);
    } catch (err) {
      setBusy(false);
      return setError(errorMessage(err));
    }
    onClose();
  }

  async function remove() {
    if (!task || !confirm(`Supprimer « ${task.title} » et son historique ?`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) return setError(errorMessage(error));
    removeLocal('tasks', task.id);
    onClose();
  }

  const whoOptions: { value: Who; label: React.ReactNode }[] = [
    ...ordered.map((m) => ({ value: m.id as Who, label: m.id === me.id ? `${m.name} (moi)` : m.name })),
    ...(partner ? [{ value: 'rotating' as Who, label: 'Alterner' }] : []),
    { value: 'together', label: 'Ensemble' },
  ];

  return (
    <Sheet title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onClose}>
      <form className="space-y-5" onSubmit={save}>
        <label className="block">
          <span className="label">Nom</span>
          <input className="input" required autoFocus={!task} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Repasser" />
        </label>

        <div>
          <span className="label">Qui ?</span>
          <div className="grid grid-cols-2 gap-2">
            {whoOptions.map((o) => {
              const m = memberById(o.value);
              const on = who === o.value;
              return (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => setWho(o.value)}
                  aria-pressed={on}
                  className={`flex min-h-12 items-center gap-2 rounded-[10px] border-[3px] px-3 text-left text-sm font-semibold ${on ? 'border-action bg-blush' : 'border-ink'}`}
                >
                  {m ? <Avatar member={m} size={24} /> : o.value === 'together' ? <Avatar together size={24} /> : <Icon name="refresh" size={20} />}
                  {o.label}
                </button>
              );
            })}
          </div>
          {mode === 'rotating' && (
            <button type="button" className="btn-link mt-2 text-sm" onClick={() => setOrder((o) => [...o].reverse())}>
              <Icon name="swap" size={16} /> {memberById(order[0])?.name ?? '—'} commence · inverser
            </button>
          )}
        </div>

        <div>
          <span className="label">Fréquence</span>
          <Segmented value={frequency} onChange={setFrequency} options={FREQ_ORDER.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))} />
        </div>

        {frequency !== 'monthly' && (
          <div>
            <span className="label">{frequency === 'daily' ? 'Jours (aucun = tous)' : 'Jours'}</span>
            <div className="flex justify-between gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = weekdays.includes(d.value);
                return (
                  <button
                    type="button"
                    key={d.value}
                    onClick={() => toggleDay(d.value)}
                    aria-label={d.long}
                    aria-pressed={on}
                    className={`aspect-square w-full max-w-11 rounded-full border-[3px] border-ink font-semibold ${on ? 'bg-ink text-cream' : ''}`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="block">
          <span className="label">{frequency === 'monthly' ? 'Premier jour (même date chaque mois)' : 'À partir du'}</span>
          <input className="input" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <div className="card-pad bg-blush">
          <h3 className="mb-2 text-lg">Prochains tours</h3>
          {preview.length ? (
            <ol className="space-y-2">
              {preview.map((p) => {
                const m = memberById(p.assigned_member_id);
                return (
                  <li key={p.date} className="flex items-center justify-between gap-2">
                    <span className="font-semibold first-letter:uppercase">{weekdayLong(p.date)} {formatShort(p.date)}</span>
                    <span className="inline-flex items-center gap-2 text-sm">
                      {mode === 'together' ? <>Ensemble <Avatar together size={22} /></> : m ? <>{m.name} <Avatar member={m} size={22} /></> : '—'}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted">Choisis au moins un jour.</p>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Rappel</span>
            <Switch checked={remind} onChange={setRemind} label="Rappel" />
          </div>
          {remind && <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Heure du rappel" required />}
        </div>

        {task && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Tâche active</span>
            <Switch checked={active} onChange={setActive} label="Tâche active" />
          </div>
        )}

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer la tâche'} <Icon name="arrow" size={18} />
        </button>
        {task && (
          <button type="button" className="btn w-full text-action" onClick={remove}>
            <Icon name="trash" size={18} /> Supprimer
          </button>
        )}
      </form>
    </Sheet>
  );
}
