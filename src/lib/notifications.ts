import { useEffect } from 'react';
import { useStore } from '../store.tsx';
import { today } from './dates.ts';
import { nextReminderDate } from './schedule.ts';

// Notifications locales : envoyées tant que l'app est ouverte (ou en arrière-plan récent).
// Pour des notifications push avec l'app fermée, voir README (« Aller plus loin »).

const SENT_KEY = 'mm:notified';

function alreadySent(key: string): boolean {
  try {
    const sent: string[] = JSON.parse(localStorage.getItem(SENT_KEY) || '[]');
    if (sent.includes(key)) return true;
    localStorage.setItem(SENT_KEY, JSON.stringify([...sent.slice(-200), key]));
    return false;
  } catch {
    return false;
  }
}

async function notify(title: string, body: string, tag: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (alreadySent(tag)) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const options = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png' };
  if (reg) reg.showNotification(title, options);
  else new Notification(title, options);
}

export function useLocalNotifications() {
  const { data, me } = useStore();

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const day = today();
      const hhmm = now.toTimeString().slice(0, 5);

      for (const o of data.occurrences) {
        if (o.date !== day || o.completed) continue;
        if (o.assigned_member_id && o.assigned_member_id !== me.id) continue;
        const task = data.tasks.find((t) => t.id === o.task_id);
        if (!task?.reminder_time || task.reminder_time.slice(0, 5) > hhmm) continue;
        notify(task.title, o.assigned_member_id ? "C'est ton tour aujourd'hui" : "À faire ensemble aujourd'hui", `task:${o.id}`);
      }

      for (const r of data.reminders) {
        if (r.assigned_member_id && r.assigned_member_id !== me.id) continue;
        const next = nextReminderDate(r, now);
        const notice = new Date(next);
        notice.setDate(notice.getDate() - r.notice_days);
        if (r.notice_days > 0 && now >= notice && now < next) {
          notify(r.title, `Dans ${Math.ceil((next.getTime() - now.getTime()) / 86_400_000)} jour(s)`, `rem-notice:${r.id}:${next.toISOString()}`);
        }
        if (now >= next && now.getTime() - next.getTime() < 86_400_000) {
          notify(r.title, r.note || "C'est maintenant", `rem:${r.id}:${next.toISOString()}`);
        }
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [data.occurrences, data.tasks, data.reminders, me.id]);
}
