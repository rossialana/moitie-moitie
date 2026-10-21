export type Color = 'rose' | 'bordeaux';
export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type AssignmentMode = 'fixed' | 'rotating' | 'together';
export type Repeat = 'none' | 'yearly' | 'monthly';

export interface Household { id: string; name: string; invite_code: string; timezone: string; created_at: string }
export interface Member { id: string; household_id: string; user_id: string; name: string; color: Color; created_at: string }

export interface Task {
  id: string;
  household_id: string;
  title: string;
  frequency: Frequency;
  weekdays: number[];
  assignment_mode: AssignmentMode;
  fixed_member_id: string | null;
  rotation_order: string[];
  start_date: string;
  reminder_time: string | null;
  active: boolean;
  created_at: string;
}

export interface TaskOccurrence {
  id: string;
  task_id: string;
  household_id: string;
  date: string;
  assigned_member_id: string | null;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  moved_from: string | null;
}

/** `id` est synthétique (= key) côté client, pour la synchro. */
export interface SuggestionDismissal { id: string; household_id: string; key: string; created_at: string }

export interface ShoppingList { id: string; household_id: string; name: string; shopper_id: string | null; date: string | null; created_at: string }

export interface ShoppingItem {
  id: string;
  list_id: string;
  household_id: string;
  name: string;
  category: string;
  quantity: string | null;
  requested_by: string | null;
  purchased: boolean;
  is_automatic: boolean;
  pantry_product_id: string | null;
  created_at: string;
}

export interface PantryProduct {
  id: string;
  household_id: string;
  name: string;
  category: string;
  duration_days: number;
  last_purchased_on: string;
  created_at: string;
}

export interface Reminder {
  id: string;
  household_id: string;
  title: string;
  due_at: string;
  assigned_member_id: string | null;
  repeat: Repeat;
  notice_days: number;
  note: string | null;
  created_at: string;
}

export interface Note { id: string; household_id: string; title: string; content: string; updated_at: string; created_at: string }

export const CATEGORIES = [
  'Épicerie',
  'Fruits et légumes',
  'Boucherie',
  'Poissonnerie',
  'Crèmerie',
  'Boulangerie',
  'Surgelés',
  'Boissons',
  'Hygiène',
  'Entretien',
  'Pharmacie',
  'Autre',
];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Tous les jours',
  weekly: 'Toutes les semaines',
  biweekly: 'Tous les 15 jours',
  monthly: 'Tous les mois',
};


export const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Une seule fois',
  monthly: 'Tous les mois',
  yearly: 'Tous les ans',
};
