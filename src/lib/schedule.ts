import { addDays, daysBetween, parseISODate, startOfWeek } from './dates.ts';
import type { Reminder, Task } from './types.ts';

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

/** Qui s'en occupe ce jour-là ? null = ensemble (ou personne de définie). */
export function assigneeFor(task: ScheduleTask, date: string, memberIds: string[]): string | null {
  if (task.assignment_mode === 'together') return null;
  if (task.assignment_mode === 'fixed') return task.fixed_member_id;
  const order = task.rotation_order.filter((id) => memberIds.includes(id));
  if (!order.length) return null;
  return order[occurrenceIndex(task, date) % order.length];
}

export function dueDatesBetween(task: ScheduleTask, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isDue(task, d)) out.push(d);
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
      const targetMonth = base.getMonth() + i;
      candidate.setDate(1);
      candidate.setMonth(targetMonth);
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

/** Seuil d'alerte : 2 jours, ou 20 % de la durée pour les produits qui durent longtemps. */
export function pantryThreshold(durationDays: number): number {
  return Math.max(2, Math.round(durationDays * 0.2));
}
