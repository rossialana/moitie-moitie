import { addDays, daysBetween, parseISODate, startOfWeek } from './dates.ts';
import type { Member, Reminder, Task, TaskOccurrence } from './types.ts';

/** Nombre de jours d'occurrences générées à l'avance (4 semaines). */
export const HORIZON_DAYS = 28;

type ScheduleTask = Pick<Task, 'frequency' | 'weekdays' | 'start_date' | 'assignment_mode' | 'fixed_member_id' | 'rotation_order'>;

function daysOfWeek(task: ScheduleTask): number[] {
  if (task.weekdays.length) return task.weekdays;
  return [parseISODate(task.start_date).getDay()];
}

/** La tâche tombe-t-elle ce jour-là ? */
export function isDue(task: ScheduleTask, date: string): boolean {
  if (date < task.start_date) return false;
  const d = parseISODate(date);
  switch (task.frequency) {
    case 'daily':
      return task.weekdays.length ? task.weekdays.includes(d.getDay()) : true;
    case 'weekly':
      return daysOfWeek(task).includes(d.getDay());
    case 'biweekly': {
      if (!daysOfWeek(task).includes(d.getDay())) return false;
      const weeks = daysBetween(startOfWeek(task.start_date), startOfWeek(date)) / 7;
      return weeks % 2 === 0;
    }
    case 'monthly': {
      // Même jour du mois que la date de début (ramené au dernier jour si le mois est plus court).
      const target = parseISODate(task.start_date).getDate();
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(target, lastDay);
    }
  }
}

/** Nombre d'occurrences entre la date de début et `date` (exclue). */
export function occurrenceIndex(task: ScheduleTask, date: string): number {
  let n = 0;
  for (let d = task.start_date; d < date; d = addDays(d, 1)) {
    if (isDue(task, d)) n++;
  }
  return n;
}

function rotationOrder(task: ScheduleTask, memberIds: string[]): string[] {
  return task.rotation_order.filter((id) => memberIds.includes(id));
}

/** Qui s'en occupe ce jour-là, sans historique ? null = ensemble (ou personne de définie). */
export function assigneeFor(task: ScheduleTask, date: string, memberIds: string[]): string | null {
  if (task.assignment_mode === 'together') return null;
  if (task.assignment_mode === 'fixed') return task.fixed_member_id;
  const order = rotationOrder(task, memberIds);
  if (!order.length) return null;
  return order[occurrenceIndex(task, date) % order.length];
}

export function dueDatesBetween(task: ScheduleTask, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isDue(task, d)) out.push(d);
  return out;
}

export type PlannedOccurrence = Pick<TaskOccurrence, 'task_id' | 'household_id' | 'date' | 'assigned_member_id' | 'completed'>;

/**
 * Occurrences manquantes entre `from` et `to`.
 * En rotation, chaque tour suit la personne du tour précédent : si quelqu'un échange un tour,
 * la suite se réorganise à partir de là.
 */
export function planOccurrences(
  tasks: (ScheduleTask & Pick<Task, 'id' | 'household_id' | 'active'>)[],
  memberIds: string[],
  existing: Pick<TaskOccurrence, 'task_id' | 'date' | 'assigned_member_id' | 'moved_from'>[],
  from: string,
  to: string,
): PlannedOccurrence[] {
  const out: PlannedOccurrence[] = [];
  for (const task of tasks) {
    if (!task.active) continue;
    const own = existing.filter((o) => o.task_id === task.id);
    const taken = new Set(own.flatMap((o) => (o.moved_from ? [o.date, o.moved_from] : [o.date])));
    // Historique par date d'origine, pour suivre la rotation.
    const history = own.map((o) => ({ date: o.moved_from ?? o.date, who: o.assigned_member_id })).sort((a, b) => a.date.localeCompare(b.date));
    const order = rotationOrder(task, memberIds);

    for (const date of dueDatesBetween(task, from, to)) {
      if (taken.has(date)) continue;
      let who = assigneeFor(task, date, memberIds);
      if (task.assignment_mode === 'rotating' && order.length) {
        const prev = [...history].reverse().find((h) => h.date < date && h.who && order.includes(h.who));
        if (prev) who = order[(order.indexOf(prev.who!) + 1) % order.length];
      }
      out.push({ task_id: task.id, household_id: task.household_id, date, assigned_member_id: who, completed: false });
      history.push({ date, who });
      history.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return out;
}

/** Tâches attribuées à chacun sur la semaine (les tâches « ensemble » comptent pour les deux). */
export function weekBalance(occurrences: Pick<TaskOccurrence, 'date' | 'assigned_member_id'>[], members: Pick<Member, 'id'>[], weekStart: string): Record<string, number> {
  const end = addDays(weekStart, 6);
  const counts: Record<string, number> = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const o of occurrences) {
    if (o.date < weekStart || o.date > end) continue;
    if (o.assigned_member_id) counts[o.assigned_member_id] = (counts[o.assigned_member_id] ?? 0) + 1;
    else for (const m of members) counts[m.id]++;
  }
  return counts;
}

export interface MoveSuggestion {
  key: string;
  occurrenceId: string;
  taskId: string;
  memberId: string;
  from: string;
  to: string;
}

/**
 * Si une personne a, un jour donné, au moins 2 tâches de plus que sa moyenne de la semaine
 * et un autre jour sans rien, on propose d'y déplacer une tâche.
 */
export function moveSuggestions(
  occurrences: Pick<TaskOccurrence, 'id' | 'task_id' | 'date' | 'assigned_member_id' | 'completed'>[],
  members: Pick<Member, 'id'>[],
  weekStart: string,
  todayIso: string,
  dismissed: Set<string>,
): MoveSuggestion[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const out: MoveSuggestion[] = [];
  for (const m of members) {
    const mine = occurrences.filter((o) => o.assigned_member_id === m.id && days.includes(o.date));
    const perDay = days.map((d) => mine.filter((o) => o.date === d).length);
    const avg = perDay.reduce((a, b) => a + b, 0) / 7;
    days.forEach((heavy, i) => {
      if (heavy < todayIso || perDay[i] < avg + 2) return;
      // « Laisser comme ça » vaut pour ce jour chargé de cette personne.
      const key = `${m.id}|${heavy}`;
      if (dismissed.has(key)) return;
      const free = days.filter((d, j) => d >= todayIso && d !== heavy && perDay[j] === 0);
      if (!free.length) return;
      // Le jour libre le plus proche ; une tâche pas encore faite qui n'existe pas déjà ce jour-là.
      free.sort((a, b) => Math.abs(daysBetween(heavy, a)) - Math.abs(daysBetween(heavy, b)));
      for (const to of free) {
        const candidate = mine.find(
          (o) => o.date === heavy && !o.completed && !occurrences.some((x) => x.task_id === o.task_id && x.date === to),
        );
        if (!candidate) continue;
        out.push({ key, occurrenceId: candidate.id, taskId: candidate.task_id, memberId: m.id, from: heavy, to });
        break;
      }
    });
  }
  return out;
}

/** Prochaine échéance d'un rappel à partir de maintenant (gère les répétitions). */
export function nextReminderDate(r: Pick<Reminder, 'due_at' | 'repeat'>, now = new Date()): Date {
  const base = new Date(r.due_at);
  if (r.repeat === 'none') return base;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(base);
  let i = 0;
  while (d < startOfToday && i < 1200) {
    i++;
    const candidate = new Date(base);
    if (r.repeat === 'yearly') candidate.setFullYear(base.getFullYear() + i);
    else {
      candidate.setDate(1);
      candidate.setMonth(base.getMonth() + i);
      const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
      candidate.setDate(Math.min(base.getDate(), lastDay));
    }
    d.setTime(candidate.getTime());
  }
  return d;
}

/** Jours restants avant la fin estimée d'un produit du garde-manger. */
export function pantryDaysLeft(lastPurchasedOn: string, durationDays: number, on: string): number {
  return durationDays - daysBetween(lastPurchasedOn, on);
}

/** « Bientôt fini » : il reste 20 % de la durée ou moins. */
export function isRunningLow(lastPurchasedOn: string, durationDays: number, on: string): boolean {
  return pantryDaysLeft(lastPurchasedOn, durationDays, on) <= durationDays * 0.2;
}
