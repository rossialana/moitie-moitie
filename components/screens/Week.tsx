'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase.ts';
import { addDays, formatShort, parseISODate, startOfWeek, today, weekdayLong } from '@/lib/dates.ts';
import { moveSuggestions, weekBalance } from '@/lib/schedule.ts';
import type { SuggestionDismissal, TaskOccurrence } from '@/lib/types.ts';
import { useStore } from '../store';
import { Avatar, ErrorText, PageTitle, Sheet, errorMessage } from '../ui';
import { Icon } from '../Icon';

export default function Week() {
  const { data, me, partner, memberById, patchLocal, moveOccurrence } = useStore();
  const [weekStart, setWeekStart] = useState(startOfWeek(today()));
  const [selected, setSelected] = useState<TaskOccurrence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const taskById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const occ = data.occurrences.filter((o) => o.date >= days[0] && o.date <= days[6] && taskById.has(o.task_id));
  const balance = weekBalance(occ, data.members, weekStart);
  const ordered = partner ? [me, partner].sort((a, b) => a.created_at.localeCompare(b.created_at)) : [me];

  const dismissed = new Set(data.dismissals.map((d) => d.key));
  const suggestion = moveSuggestions(occ, data.members, weekStart, today(), dismissed)[0];
  const suggestedTask = suggestion && taskById.get(suggestion.taskId);

  async function accept() {
    const o = suggestion && data.occurrences.find((x) => x.id === suggestion.occurrenceId);
    if (!o) return;
    setBusy(true);
    try {
      await moveOccurrence(o, suggestion.to);
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  async function dismiss() {
    if (!suggestion) return;
    const key = `${suggestion.memberId}|${suggestion.from}`;
    const row: SuggestionDismissal = { id: key, household_id: data.household.id, key, created_at: new Date().toISOString() };
    patchLocal('dismissals', row);
    const { error } = await supabase.from('suggestion_dismissals').insert({ household_id: row.household_id, key: row.key });
    if (error && error.code !== '23505') setError(errorMessage(error));
  }

  const isCurrent = weekStart === startOfWeek(today());

  return (
    <>
      <PageTitle title="Semaine" subtitle={`Du ${formatShort(days[0])} au ${formatShort(days[6])}`} />

      <div className="flex items-center justify-between gap-2">
        <button className="btn btn-small" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semaine précédente"><Icon name="back" size={18} /></button>
        <button className="btn btn-small flex-1" onClick={() => setWeekStart(startOfWeek(today()))} disabled={isCurrent}>
          {isCurrent ? 'Cette semaine' : "Revenir à aujourd'hui"}
        </button>
        <button className="btn btn-small" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Semaine suivante"><Icon name="next" size={18} /></button>
      </div>

      {suggestion && suggestedTask && (
        <section className="card-pad space-y-3 bg-blush" aria-live="polite">
          <p className="text-sm font-semibold text-muted">
            Suggestion pour {memberById(suggestion.memberId)?.id === me.id ? 'toi' : memberById(suggestion.memberId)?.name}
          </p>
          <h2 className="text-2xl leading-tight">On passe « {suggestedTask.title} » à {weekdayLong(suggestion.to)} ?</h2>
          <p className="text-sm">
            {weekdayLong(suggestion.from).replace(/^./, (c) => c.toUpperCase())} est chargé, {weekdayLong(suggestion.to)} est libre.
          </p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={accept} disabled={busy}>Oui, déplacer</button>
            <button className="btn flex-1" onClick={dismiss}>Laisser comme ça</button>
          </div>
        </section>
      )}
      <ErrorText>{error}</ErrorText>

      <section className="card overflow-hidden" aria-label="Planning de la semaine">
        {days.map((d, i) => {
          const list = occ.filter((o) => o.date === d).sort((a, b) => (taskById.get(a.task_id)?.title ?? '').localeCompare(taskById.get(b.task_id)?.title ?? ''));
          const isToday = d === today();
          return (
            <div key={d} className={`flex gap-3 px-3 py-3 ${i ? 'border-t-[3px] border-ink' : ''} ${isToday ? 'bg-blush' : ''} ${d < today() ? 'opacity-60' : ''}`}>
              <div className="w-11 shrink-0 text-center">
                <p className="font-display text-sm uppercase">{weekdayLong(d).slice(0, 3)}</p>
                <p className="font-display text-2xl leading-none">{parseISODate(d).getDate()}</p>
              </div>
              <div className="flex min-h-9 flex-1 flex-wrap items-center gap-1.5">
                {list.length === 0 && <span className="text-sm text-muted">Libre</span>}
                {list.map((o) => {
                  const task = taskById.get(o.task_id)!;
                  const m = memberById(o.assigned_member_id);
                  const color = task.assignment_mode === 'together' || !m ? 'bg-cream text-ink' : `person-${m.color}`;
                  return (
                    <button
                      key={o.id}
                      onClick={() => setSelected(o)}
                      className={`max-w-full truncate rounded-full border-2 border-ink px-2.5 py-1 text-xs font-semibold ${color} ${o.completed ? 'line-through opacity-60' : ''}`}
                    >
                      {task.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold">
        {ordered.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-2"><Avatar member={m} size={20} /> {m.name} · {balance[m.id] ?? 0}</span>
        ))}
        <span className="inline-flex items-center gap-2"><span className="h-4 w-6 rounded-full border-2 border-ink bg-cream" /> Ensemble</span>
      </div>

      {selected && <OccurrenceSheet occurrence={data.occurrences.find((o) => o.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function OccurrenceSheet({ occurrence: o, onClose }: { occurrence: TaskOccurrence; onClose: () => void }) {
  const { data, me, partner, memberById, patchLocal, swapOccurrence } = useStore();
  const task = data.tasks.find((t) => t.id === o.task_id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!task) return null;
  const who = memberById(o.assigned_member_id);
  const other = data.members.find((m) => m.id !== o.assigned_member_id);

  async function toggle() {
    const done = !o.completed;
    const next = { ...o, completed: done, completed_by: done ? me.id : null, completed_at: done ? new Date().toISOString() : null };
    patchLocal('occurrences', next);
    const { error } = await supabase.from('task_occurrences').update({ completed: next.completed, completed_by: next.completed_by, completed_at: next.completed_at }).eq('id', o.id);
    if (error) {
      patchLocal('occurrences', o);
      return setError(errorMessage(error));
    }
    onClose();
  }

  async function swap() {
    if (!other) return;
    setBusy(true);
    try {
      await swapOccurrence(o, other.id);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title={task.title} onClose={onClose}>
      <div className="space-y-4">
        <p className="font-semibold first-letter:uppercase">{weekdayLong(o.date)} {formatShort(o.date)}{task.reminder_time && ` · ${task.reminder_time.slice(0, 5)}`}</p>
        <div className="card-pad flex items-center gap-3">
          {task.assignment_mode === 'together' ? <Avatar together size={36} /> : <Avatar member={who} size={36} />}
          <span className="font-semibold">{task.assignment_mode === 'together' ? 'Ensemble' : who ? (who.id === me.id ? 'Toi' : who.name) : 'Personne'}</span>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" onClick={toggle}>{o.completed ? 'Marquer comme pas fait' : 'Marquer comme fait'}</button>
        {task.assignment_mode !== 'together' && partner && other && !o.completed && (
          <>
            <button className="btn w-full" onClick={swap} disabled={busy}>
              <Icon name="swap" size={18} /> Donner ce tour à {other.id === me.id ? 'moi' : other.name}
            </button>
            {task.assignment_mode === 'rotating' && <p className="text-sm text-muted">La rotation se réorganise à partir de ce tour.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
