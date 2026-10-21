import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { addDays, nowInZone } from '@/lib/dates.ts';
import { HORIZON_DAYS, nextReminderDate, planOccurrences } from '@/lib/schedule.ts';
import type { Household, Member, Reminder, Task, TaskOccurrence } from '@/lib/types.ts';

// Appelé toutes les 5 minutes par pg_cron (voir supabase/cron.sql) ou par un cron Vercel.
// 1. complète les occurrences des 4 prochaines semaines ;
// 2. envoie les notifications dues (une seule fois chacune, grâce à push_log).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
const LATE_LIMIT_MIN = 180; // au-delà de 3 h de retard, on n'envoie plus le rappel d'une tâche

interface Subscription { id: string; member_id: string; endpoint: string; p256dh: string; auth: string }
interface Message { key: string; members: string[]; title: string; body: string }

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'non autorisé' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublic, VAPID_PRIVATE_KEY: vapidPrivate, VAPID_SUBJECT: subject } = process.env;
  if (!url || !serviceKey) return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquante' }, { status: 500 });

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const canPush = Boolean(vapidPublic && vapidPrivate);
  if (canPush) webpush.setVapidDetails(subject || 'mailto:contact@exemple.fr', vapidPublic!, vapidPrivate!);

  const { data: households, error } = await db.from('households').select('*').returns<Household[]>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = new Date();
  let planned = 0;
  let sent = 0;

  for (const h of households ?? []) {
    const local = nowInZone(h.timezone || 'Europe/Paris', now);
    const [members, tasks, occurrences, reminders, subs] = await Promise.all([
      db.from('members').select('*').eq('household_id', h.id).returns<Member[]>(),
      db.from('tasks').select('*').eq('household_id', h.id).returns<Task[]>(),
      db.from('task_occurrences').select('*').eq('household_id', h.id).gte('date', addDays(local.date, -14)).returns<TaskOccurrence[]>(),
      db.from('reminders').select('*').eq('household_id', h.id).returns<Reminder[]>(),
      db.from('push_subscriptions').select('*').eq('household_id', h.id).returns<Subscription[]>(),
    ]);
    const memberIds = (members.data ?? []).map((m) => m.id);
    const taskById = new Map((tasks.data ?? []).map((t) => [t.id, t]));

    // 1. Occurrences à venir.
    const rows = planOccurrences(tasks.data ?? [], memberIds, occurrences.data ?? [], local.date, addDays(local.date, HORIZON_DAYS));
    if (rows.length) {
      await db.from('task_occurrences').upsert(rows, { onConflict: 'task_id,date', ignoreDuplicates: true });
      planned += rows.length;
    }

    if (!canPush || !subs.data?.length) continue;

    // 2. Notifications.
    const messages: Message[] = [];
    const todays = (occurrences.data ?? []).filter((o) => o.date === local.date && !o.completed && taskById.get(o.task_id)?.active);

    // Récapitulatif du matin (8 h) pour chacun.
    if (local.time >= '08:00') {
      for (const id of memberIds) {
        const mine = todays.filter((o) => !o.assigned_member_id || o.assigned_member_id === id).map((o) => taskById.get(o.task_id)!.title);
        if (mine.length) {
          messages.push({
            key: `digest:${id}:${local.date}`,
            members: [id],
            title: `Aujourd'hui : ${mine.length} tâche${mine.length > 1 ? 's' : ''}`,
            body: mine.join(', '),
          });
        }
      }
    }

    // À l'heure de rappel de chaque tâche.
    for (const o of todays) {
      const task = taskById.get(o.task_id)!;
      if (!task.reminder_time) continue;
      const late = minutes(local.time) - minutes(task.reminder_time);
      if (late < 0 || late > LATE_LIMIT_MIN) continue;
      messages.push({
        key: `task:${o.id}`,
        members: o.assigned_member_id ? [o.assigned_member_id] : memberIds,
        title: task.title,
        body: o.assigned_member_id ? "C'est ton tour aujourd'hui." : "À faire ensemble aujourd'hui.",
      });
    }

    // Rappels : préavis puis échéance.
    for (const r of reminders.data ?? []) {
      const next = nextReminderDate(r, now);
      const targets = r.assigned_member_id ? [r.assigned_member_id] : memberIds;
      const stamp = next.toISOString();
      const days = Math.ceil((next.getTime() - now.getTime()) / DAY);
      if (r.notice_days > 0 && next.getTime() > now.getTime() && next.getTime() - now.getTime() <= r.notice_days * DAY) {
        messages.push({ key: `rem-notice:${r.id}:${stamp}`, members: targets, title: r.title, body: days <= 1 ? 'Demain' : `Dans ${days} jours` });
      }
      if (now >= next && now.getTime() - next.getTime() < 6 * 3_600_000) {
        messages.push({ key: `rem:${r.id}:${stamp}`, members: targets, title: r.title, body: r.note || "C'est maintenant." });
      }
    }

    if (!messages.length) continue;

    // Ne garder que les messages jamais envoyés (insertion = verrou).
    const { data: fresh } = await db
      .from('push_log')
      .upsert(messages.map((m) => ({ key: m.key })), { onConflict: 'key', ignoreDuplicates: true })
      .select('key');
    const toSend = new Set((fresh ?? []).map((r: { key: string }) => r.key));

    for (const msg of messages.filter((m) => toSend.has(m.key))) {
      for (const sub of subs.data.filter((s) => msg.members.includes(s.member_id))) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: msg.title, body: msg.body, tag: msg.key, url: '/' }),
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // Abonnement expiré (appareil désinstallé, permission retirée).
          if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', sub.id);
          else console.error('push', status, (e as Error).message);
        }
      }
    }
  }

  return Response.json({ ok: true, households: households?.length ?? 0, planned, sent, push: canPush });
}

export const GET = handle;
export const POST = handle;
