import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assigneeFor, dueDatesBetween, isDue, nextReminderDate, pantryDaysLeft, planOccurrences, weekBalance, moveSuggestions, isRunningLow } from './schedule.ts';

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

const rotating = {
  id: 't', household_id: 'h', active: true, frequency: 'weekly' as const, weekdays: [1],
  start_date: '2026-10-19', assignment_mode: 'rotating' as const, fixed_member_id: null, rotation_order: ['a', 'b'],
};

test('génère 4 semaines et alterne', () => {
  const rows = planOccurrences([rotating], ['a', 'b'], [], '2026-10-19', '2026-11-15');
  assert.deepEqual(rows.map((r) => `${r.date}:${r.assigned_member_id}`), ['2026-10-19:a', '2026-10-26:b', '2026-11-02:a', '2026-11-09:b']);
});

test('un échange réorganise la rotation à partir de là', () => {
  // Le 26/10, b a donné son tour à a : la suite repart de a.
  const existing = [
    { task_id: 't', date: '2026-10-19', assigned_member_id: 'a', moved_from: null },
    { task_id: 't', date: '2026-10-26', assigned_member_id: 'a', moved_from: null },
  ];
  const rows = planOccurrences([rotating], ['a', 'b'], existing, '2026-10-27', '2026-11-15');
  assert.deepEqual(rows.map((r) => `${r.date}:${r.assigned_member_id}`), ['2026-11-02:b', '2026-11-09:a']);
});

test('une occurrence déplacée n’est pas recréée à son ancien jour', () => {
  const existing = [{ task_id: 't', date: '2026-10-23', assigned_member_id: 'a', moved_from: '2026-10-19' }];
  const rows = planOccurrences([rotating], ['a', 'b'], existing, '2026-10-19', '2026-10-25');
  assert.equal(rows.length, 0);
});

test('balance : ensemble compte pour les deux', () => {
  const occ = [
    { date: '2026-10-19', assigned_member_id: 'a' },
    { date: '2026-10-20', assigned_member_id: null },
    { date: '2026-10-27', assigned_member_id: 'b' },
  ];
  assert.deepEqual(weekBalance(occ, [{ id: 'a' }, { id: 'b' }], '2026-10-19'), { a: 2, b: 1 });
});

test('suggestion : jour chargé + jour libre', () => {
  const occ = [
    ...['x1', 'x2', 'x3'].map((id) => ({ id, task_id: id, date: '2026-10-22', assigned_member_id: 'a', completed: false })),
    { id: 'y', task_id: 'y', date: '2026-10-21', assigned_member_id: 'a', completed: false },
    { id: 'z', task_id: 'z', date: '2026-10-24', assigned_member_id: 'a', completed: false },
  ];
  const s = moveSuggestions(occ, [{ id: 'a' }], '2026-10-19', '2026-10-21', new Set());
  assert.equal(s.length, 1);
  assert.equal(s[0].from, '2026-10-22');
  assert.equal(s[0].to, '2026-10-23');
  assert.equal(moveSuggestions(occ, [{ id: 'a' }], '2026-10-19', '2026-10-21', new Set([s[0].key])).length, 0);
});

test('garde-manger : alerte à 20 %', () => {
  assert.equal(isRunningLow('2026-10-01', 10, '2026-10-09'), true);
  assert.equal(isRunningLow('2026-10-01', 10, '2026-10-08'), false);
});
