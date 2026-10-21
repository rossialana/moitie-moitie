import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assigneeFor, dueDatesBetween, isDue, nextReminderDate, pantryDaysLeft } from './schedule.ts';

const base = {
  weekdays: [] as number[],
  assignment_mode: 'fixed' as const,
  fixed_member_id: 'a',
  rotation_order: [] as string[],
};

test('quotidien sans jours = tous les jours', () => {
  const t = { ...base, frequency: 'daily' as const, start_date: '2026-10-19' };
  assert.equal(dueDatesBetween(t, '2026-10-19', '2026-10-25').length, 7);
  assert.equal(isDue(t, '2026-10-18'), false);
});

test('hebdo sur lundi et jeudi', () => {
  const t = { ...base, frequency: 'weekly' as const, weekdays: [1, 4], start_date: '2026-10-19' };
  assert.deepEqual(dueDatesBetween(t, '2026-10-19', '2026-10-31'), ['2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29']);
});

test('tous les 15 jours : une semaine sur deux', () => {
  const t = { ...base, frequency: 'biweekly' as const, weekdays: [6], start_date: '2026-10-21' };
  assert.deepEqual(dueDatesBetween(t, '2026-10-19', '2026-11-15'), ['2026-10-24', '2026-11-07']);
});

test('mensuel le 31 → dernier jour des mois courts', () => {
  const t = { ...base, frequency: 'monthly' as const, start_date: '2026-01-31' };
  assert.deepEqual(dueDatesBetween(t, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
});

test('rotation alterne entre les deux', () => {
  const t = { ...base, frequency: 'weekly' as const, weekdays: [1], start_date: '2026-10-19', assignment_mode: 'rotating' as const, rotation_order: ['a', 'b'] };
  const who = ['2026-10-19', '2026-10-26', '2026-11-02'].map((d) => assigneeFor(t, d, ['a', 'b']));
  assert.deepEqual(who, ['a', 'b', 'a']);
});

test('ensemble = personne en particulier', () => {
  const t = { ...base, frequency: 'daily' as const, start_date: '2026-10-19', assignment_mode: 'together' as const };
  assert.equal(assigneeFor(t, '2026-10-20', ['a', 'b']), null);
});

test('rappel annuel passé → l’année suivante', () => {
  const d = nextReminderDate({ due_at: '2025-03-10T09:00:00', repeat: 'yearly' }, new Date('2026-10-21T12:00:00'));
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 2);
});

test('rappel mensuel le 31', () => {
  const d = nextReminderDate({ due_at: '2026-01-31T09:00:00', repeat: 'monthly' }, new Date('2026-11-05T12:00:00'));
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 30);
});

test('garde-manger : jours restants', () => {
  assert.equal(pantryDaysLeft('2026-10-01', 30, '2026-10-21'), 10);
});
