// Toutes les dates « jour » sont des chaînes YYYY-MM-DD en heure locale.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** Lundi de la semaine (la semaine commence le lundi en France). */
export function startOfWeek(s: string): string {
  const d = parseISODate(s);
  const offset = (d.getDay() + 6) % 7;
  return addDays(s, -offset);
}

const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function formatLong(s: string): string {
  const out = fmtLong.format(parseISODate(s));
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function formatShort(s: string): string {
  return fmtShort.format(parseISODate(s));
}

export function formatTime(d: Date): string {
  return fmtTime.format(d);
}

/** Date du jour et heure HH:MM dans un fuseau donné (pour le serveur). */
export function nowInZone(timeZone: string, at = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function weekdayLong(s: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(parseISODate(s));
}

export function relativeDay(s: string): string {
  const diff = daysBetween(today(), s);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff === -1) return 'Hier';
  if (diff > 1 && diff < 7) return `Dans ${diff} jours`;
  if (diff < -1 && diff > -7) return `Il y a ${-diff} jours`;
  return formatShort(s);
}

/** Lundi → dimanche, avec les numéros JS (0 = dimanche). */
export const WEEKDAYS: { value: number; short: string; long: string }[] = [
  { value: 1, short: 'L', long: 'lundi' },
  { value: 2, short: 'M', long: 'mardi' },
  { value: 3, short: 'M', long: 'mercredi' },
  { value: 4, short: 'J', long: 'jeudi' },
  { value: 5, short: 'V', long: 'vendredi' },
  { value: 6, short: 'S', long: 'samedi' },
  { value: 0, short: 'D', long: 'dimanche' },
];
