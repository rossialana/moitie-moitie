import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RealtimePostgresChangesPayload, Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase.ts';
import { addDays, today } from './lib/dates.ts';
import { assigneeFor, dueDatesBetween, pantryDaysLeft, pantryThreshold } from './lib/schedule.ts';
import type {
  Household, Member, Note, PantryProduct, Reminder, ShoppingItem, ShoppingList, Task, TaskOccurrence,
} from './lib/types.ts';

// Fenêtre d'occurrences chargées et générées autour d'aujourd'hui.
const PAST_DAYS = 14;
const FUTURE_DAYS = 21;

export interface HouseholdData {
  household: Household;
  members: Member[];
  tasks: Task[];
  occurrences: TaskOccurrence[];
  lists: ShoppingList[];
  items: ShoppingItem[];
  pantry: PantryProduct[];
  reminders: Reminder[];
  notes: Note[];
}

type TableKey = Exclude<keyof HouseholdData, 'household'>;

const TABLES: Record<TableKey, string> = {
  members: 'members',
  tasks: 'tasks',
  occurrences: 'task_occurrences',
  lists: 'shopping_lists',
  items: 'shopping_items',
  pantry: 'pantry_products',
  reminders: 'reminders',
  notes: 'notes',
};

interface Ctx {
  data: HouseholdData;
  me: Member;
  partner: Member | null;
  memberById: (id: string | null | undefined) => Member | null;
  /** Mise à jour locale immédiate ; le temps réel confirme ensuite. */
  patchLocal: <K extends TableKey>(key: K, row: HouseholdData[K][number]) => void;
  removeLocal: (key: TableKey, id: string) => void;
  regenerateTaskOccurrences: (task: Task) => Promise<void>;
  online: boolean;
}

const StoreContext = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore hors du StoreProvider');
  return ctx;
}

function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) return [...rows, row];
  const copy = rows.slice();
  copy[i] = row;
  return copy;
}

async function fetchAll(householdId: string): Promise<HouseholdData> {
  const from = addDays(today(), -PAST_DAYS);
  const to = addDays(today(), FUTURE_DAYS);
  const q = (table: string) => supabase.from(table).select('*').eq('household_id', householdId);
  const [household, members, tasks, occurrences, lists, items, pantry, reminders, notes] = await Promise.all([
    supabase.from('households').select('*').eq('id', householdId).single<Household>(),
    q('members').order('created_at').returns<Member[]>(),
    q('tasks').order('created_at').returns<Task[]>(),
    q('task_occurrences').gte('date', from).lte('date', to).returns<TaskOccurrence[]>(),
    q('shopping_lists').order('created_at').returns<ShoppingList[]>(),
    q('shopping_items').order('created_at').returns<ShoppingItem[]>(),
    q('pantry_products').order('name').returns<PantryProduct[]>(),
    q('reminders').order('due_at').returns<Reminder[]>(),
    q('notes').order('updated_at', { ascending: false }).returns<Note[]>(),
  ]);
  const err = [household, members, tasks, occurrences, lists, items, pantry, reminders, notes].find((r) => r.error)?.error;
  if (err) throw err;
  return {
    household: household.data!,
    members: members.data ?? [],
    tasks: tasks.data ?? [],
    occurrences: occurrences.data ?? [],
    lists: lists.data ?? [],
    items: items.data ?? [],
    pantry: pantry.data ?? [],
    reminders: reminders.data ?? [],
    notes: notes.data ?? [],
  };
}

/** Crée les occurrences manquantes (les deux téléphones peuvent le faire en même temps : la contrainte unique tranche). */
async function ensureOccurrences(data: HouseholdData, onlyTask?: Task) {
  const from = today();
  const to = addDays(from, FUTURE_DAYS);
  const memberIds = data.members.map((m) => m.id);
  const existing = new Set(data.occurrences.map((o) => `${o.task_id}|${o.date}`));
  const rows: Omit<TaskOccurrence, 'id' | 'completed_by' | 'completed_at'>[] = [];
  for (const task of onlyTask ? [onlyTask] : data.tasks) {
    if (!task.active) continue;
    for (const date of dueDatesBetween(task, from, to)) {
      if (existing.has(`${task.id}|${date}`)) continue;
      rows.push({
        task_id: task.id,
        household_id: task.household_id,
        date,
        assigned_member_id: assigneeFor(task, date, memberIds),
        completed: false,
      });
    }
  }
  if (!rows.length) return;
  const { error } = await supabase.from('task_occurrences').upsert(rows, { onConflict: 'task_id,date', ignoreDuplicates: true });
  if (error) console.error(error);
}

/** Ajoute automatiquement à la liste de courses les produits du garde-manger qui arrivent à leur fin. */
async function ensurePantryItems(data: HouseholdData, me: Member) {
  const list = data.lists.find((l) => l.name === 'Supermarché') ?? data.lists[0];
  if (!list) return;
  const pending = new Set(data.items.filter((i) => !i.purchased && i.pantry_product_id).map((i) => i.pantry_product_id));
  const rows = data.pantry
    .filter((p) => !pending.has(p.id) && pantryDaysLeft(p.last_purchased_on, p.duration_days, today()) <= pantryThreshold(p.duration_days))
    .map((p) => ({
      list_id: list.id,
      household_id: data.household.id,
      name: p.name,
      category: p.category,
      requested_by: me.id,
      is_automatic: true,
      pantry_product_id: p.id,
    }));
  for (const row of rows) {
    const { error } = await supabase.from('shopping_items').insert(row);
    // 23505 = l'autre téléphone vient de l'ajouter : rien à faire.
    if (error && error.code !== '23505') console.error(error);
  }
}

export function StoreProvider({ session, householdId, children }: { session: Session; householdId: string; children: ReactNode }) {
  const [data, setData] = useState<HouseholdData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const dataRef = useRef<HouseholdData | null>(null);
  dataRef.current = data;

  const reload = useCallback(async () => {
    try {
      setData(await fetchAll(householdId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [householdId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Temps réel : une seule chaîne pour tout le foyer.
  useEffect(() => {
    const channel = supabase.channel(`foyer:${householdId}`);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'households', filter: `id=eq.${householdId}` },
      (p) => p.eventType === 'UPDATE' && setData((d) => (d ? { ...d, household: p.new as Household } : d)),
    );
    for (const [key, table] of Object.entries(TABLES) as [TableKey, string][]) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
        (p: RealtimePostgresChangesPayload<{ id: string }>) => {
          setData((d) => {
            if (!d) return d;
            const rows = d[key] as { id: string }[];
            if (p.eventType === 'DELETE') return { ...d, [key]: rows.filter((r) => r.id !== (p.old as { id: string }).id) };
            return { ...d, [key]: upsertById(rows, p.new) };
          });
        },
      );
    }
    channel.subscribe((status) => {
      // Après une coupure, on recharge tout pour ne rien rater.
      if (status === 'SUBSCRIBED' && dataRef.current) reload();
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [householdId, reload]);

  // Retour sur l'app (téléphone sorti de veille) ou retour du réseau → resynchronisation.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && reload();
    const onOnline = () => {
      setOnline(true);
      reload();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [reload]);

  const me = data?.members.find((m) => m.user_id === session.user.id) ?? null;

  // Génération des occurrences et des articles automatiques quand les données de base changent.
  const tasksKey = data ? data.tasks.map((t) => `${t.id}:${t.active}`).join(',') + data.members.length : '';
  const pantryKey = data ? data.pantry.map((p) => `${p.id}:${p.last_purchased_on}:${p.duration_days}`).join(',') : '';
  useEffect(() => {
    if (dataRef.current) ensureOccurrences(dataRef.current);
  }, [tasksKey]);
  useEffect(() => {
    if (dataRef.current && me) ensurePantryItems(dataRef.current, me);
  }, [pantryKey, me?.id]);

  const patchLocal = useCallback(<K extends TableKey>(key: K, row: HouseholdData[K][number]) => {
    setData((d) => (d ? { ...d, [key]: upsertById(d[key] as { id: string }[], row as { id: string }) } : d));
  }, []);

  const removeLocal = useCallback((key: TableKey, id: string) => {
    setData((d) => (d ? { ...d, [key]: (d[key] as { id: string }[]).filter((r) => r.id !== id) } : d));
  }, []);

  const regenerateTaskOccurrences = useCallback(async (task: Task) => {
    // Les occurrences futures non faites sont recalculées (le passé et ce qui est fait ne bougent pas).
    const { error } = await supabase
      .from('task_occurrences')
      .delete()
      .eq('task_id', task.id)
      .eq('completed', false)
      .gte('date', today());
    if (error) throw error;
    const d = dataRef.current;
    if (!d) return;
    const kept = d.occurrences.filter((o) => o.task_id !== task.id || o.completed || o.date < today());
    setData({ ...d, occurrences: kept });
    await ensureOccurrences({ ...d, occurrences: kept }, task);
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!data || !me) return null;
    return {
      data,
      me,
      partner: data.members.find((m) => m.id !== me.id) ?? null,
      memberById: (id) => data.members.find((m) => m.id === id) ?? null,
      patchLocal,
      removeLocal,
      regenerateTaskOccurrences,
      online,
    };
  }, [data, me, patchLocal, removeLocal, regenerateTaskOccurrences, online]);

  if (error) {
    return (
      <div className="center-screen">
        <p>Impossible de charger le foyer.</p>
        <p className="muted small">{error}</p>
        <button className="btn" onClick={reload}>Réessayer</button>
      </div>
    );
  }
  if (!value) return <div className="center-screen"><div className="spinner" /></div>;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
