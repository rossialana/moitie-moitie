-- Moitié-Moitié 0002 : déplacement de tâches, suggestions, notifications push, données d'exemple.
-- À exécuter après 0001 (SQL Editor → New query → Run).

-- ───────────────────────── Déplacements & fuseau ─────────────────────────

-- Une occurrence déplacée garde sa date d'origine, pour ne pas être recréée à l'ancien jour.
alter table public.task_occurrences add column if not exists moved_from date;

-- Les notifications sont calculées à l'heure du foyer.
alter table public.households add column if not exists timezone text not null default 'Europe/Paris';

-- « Laisser comme ça » sur une suggestion : partagé entre les deux.
create table if not exists public.suggestion_dismissals (
  household_id uuid not null references public.households(id) on delete cascade,
  key          text not null,
  created_at   timestamptz not null default now(),
  primary key (household_id, key)
);
alter table public.suggestion_dismissals enable row level security;
create policy "membres du foyer" on public.suggestion_dismissals for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
grant select, insert, delete on public.suggestion_dismissals to authenticated;

-- ───────────────────────── Notifications push ─────────────────────────

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
-- Chacun gère uniquement les abonnements de ses propres appareils.
create policy "mes appareils" on public.push_subscriptions for all
  using (exists (select 1 from public.members m where m.id = member_id and m.user_id = auth.uid()))
  with check (
    public.is_member(household_id)
    and exists (select 1 from public.members m where m.id = member_id and m.user_id = auth.uid() and m.household_id = push_subscriptions.household_id)
  );
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Journal des envois (lu et écrit uniquement par le serveur, avec la clé secrète).
create table if not exists public.push_log (
  key     text primary key,
  sent_at timestamptz not null default now()
);
alter table public.push_log enable row level security;

alter table public.suggestion_dismissals replica identity full;
alter publication supabase_realtime add table public.suggestion_dismissals;

-- ───────────────────────── Données d'exemple ─────────────────────────
-- Usage : les deux personnes se connectent une fois (lien magique), puis dans le SQL Editor :
--   select public.seed_demo('nicki@exemple.fr', 'ari@exemple.fr');
-- Crée le foyer « Chez Nicki et Ari » (ou le complète si l'une des deux en a déjà un) et le remplit.

create or replace function public.seed_demo(email_1 text, email_2 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  u1 uuid; u2 uuid; hid uuid; m1 uuid; m2 uuid; l_super uuid; l_pharma uuid; l_maison uuid;
  monday date := date_trunc('week', current_date)::date;
  -- Demain est volontairement chargé pour Nicki : la page Semaine proposera d'en déplacer une tâche.
  busy_day smallint := extract(dow from current_date + 1)::smallint;
begin
  select id into u1 from auth.users where lower(email) = lower(email_1);
  select id into u2 from auth.users where lower(email) = lower(email_2);
  if u1 is null or u2 is null then
    raise exception 'Les deux adresses doivent s''être connectées au moins une fois';
  end if;

  select household_id into hid from members where user_id in (u1, u2) limit 1;
  if hid is null then
    insert into households (name, invite_code) values ('Chez Nicki et Ari', upper(substr(md5(random()::text), 1, 6))) returning id into hid;
  end if;
  if exists (select 1 from members where user_id in (u1, u2) and household_id <> hid) then
    raise exception 'Les deux personnes sont déjà dans des foyers différents';
  end if;

  insert into members (household_id, user_id, name, color) values (hid, u1, 'Nicki', 'rose') on conflict (user_id) do nothing;
  insert into members (household_id, user_id, name, color) values (hid, u2, 'Ari', 'bordeaux') on conflict (user_id) do nothing;
  select id into m1 from members where user_id = u1;
  select id into m2 from members where user_id = u2;

  -- On repart d'un foyer propre (sans toucher aux membres).
  delete from tasks where household_id = hid;
  delete from shopping_lists where household_id = hid;
  delete from pantry_products where household_id = hid;
  delete from reminders where household_id = hid;
  delete from notes where household_id = hid;

  insert into tasks (household_id, title, frequency, weekdays, assignment_mode, fixed_member_id, rotation_order, start_date, reminder_time) values
    (hid, 'Faire la vaisselle',        'daily',    '{}',              'rotating', null, array[m1, m2], monday, '20:30'),
    (hid, 'Sortir les poubelles',      'weekly',   '{1,4}',           'rotating', null, array[m2, m1], monday, '19:00'),
    (hid, 'Arroser les plantes',       'weekly',   '{3,6}',           'fixed',    m2,   '{}',          monday, '09:00'),
    (hid, 'Repasser',                  'weekly',   array[busy_day],   'fixed',    m1,   '{}',          monday, null),
    (hid, 'Lessive',                   'weekly',   array[busy_day],   'fixed',    m1,   '{}',          monday, '10:00'),
    (hid, 'Changer les draps',         'weekly',   array[busy_day],   'fixed',    m1,   '{}',          monday, null),
    (hid, 'Nettoyer la salle de bain', 'weekly',   array[busy_day],   'fixed',    m1,   '{}',          monday, '18:00'),
    (hid, 'Courses de la semaine',     'weekly',   '{6}',             'together', null, '{}',          monday, '10:30'),
    (hid, 'Passer l''aspirateur',      'biweekly', '{0}',             'rotating', null, array[m2, m1], monday, null),
    (hid, 'Grand ménage',              'monthly',  '{}',              'together', null, '{}',          monday + 5, '10:00'),
    (hid, 'Payer le loyer',            'monthly',  '{}',              'fixed',    m2,   '{}',          date_trunc('month', current_date)::date, '09:00');

  insert into shopping_lists (household_id, name, shopper_id, date) values (hid, 'Supermarché', m2, monday + 5) returning id into l_super;
  insert into shopping_lists (household_id, name) values (hid, 'Pharmacie') returning id into l_pharma;
  insert into shopping_lists (household_id, name) values (hid, 'Pour la maison') returning id into l_maison;

  insert into shopping_items (list_id, household_id, name, category, quantity, requested_by) values
    (l_super,  hid, 'Tomates',          'Fruits et légumes', '1 kg',  m1),
    (l_super,  hid, 'Pommes',           'Fruits et légumes', '6',     m2),
    (l_super,  hid, 'Baguette',         'Boulangerie',       '2',     m2),
    (l_super,  hid, 'Comté',            'Crèmerie',          '300 g', m1),
    (l_super,  hid, 'Yaourts nature',   'Crèmerie',          '8',     m1),
    (l_super,  hid, 'Pâtes',            'Épicerie',          '2 paquets', m2),
    (l_super,  hid, 'Eau pétillante',   'Boissons',          '6 bouteilles', m2),
    (l_pharma, hid, 'Doliprane',        'Pharmacie',         '1 boîte', m1),
    (l_pharma, hid, 'Crème solaire',    'Hygiène',           null,    m2),
    (l_maison, hid, 'Ampoules E27',     'Entretien',         '2',     m2),
    (l_maison, hid, 'Éponges',          'Entretien',         null,    m1);

  insert into pantry_products (household_id, name, category, duration_days, last_purchased_on) values
    (hid, 'Café en grains',     'Épicerie',  14, current_date - 12),
    (hid, 'Lessive',            'Entretien', 40, current_date - 34),
    (hid, 'Papier toilette',    'Hygiène',   21, current_date - 5),
    (hid, 'Huile d''olive',     'Épicerie',  45, current_date - 10),
    (hid, 'Liquide vaisselle',  'Entretien', 30, current_date - 26);

  insert into reminders (household_id, title, due_at, assigned_member_id, repeat, notice_days, note) values
    (hid, 'Anniversaire de maman',  (current_date + 3 + time '09:00') at time zone 'Europe/Paris', null, 'yearly',  7, 'Idée cadeau : le livre de cuisine de Cyril Lignac'),
    (hid, 'Contrôle technique',     (current_date + 18 + time '08:30') at time zone 'Europe/Paris', m2,  'none',    5, 'Garage Dupont, 12 rue des Lilas'),
    (hid, 'Vaccin du chat',         (current_date + 9 + time '17:45') at time zone 'Europe/Paris', m1,  'yearly',  3, null),
    (hid, 'Facture d''électricité', (current_date + 6 + time '09:00') at time zone 'Europe/Paris', null, 'monthly', 2, 'Prélèvement EDF');

  insert into notes (household_id, title, content) values
    (hid, 'Wifi',       'Réseau : Freebox-7A2C' || chr(10) || 'Mot de passe : sous la box'),
    (hid, 'Mesures',    'Fenêtre du salon : 140 × 120 cm' || chr(10) || 'Matelas : 160 × 200 cm' || chr(10) || 'Canapé : 210 cm'),
    (hid, 'Téléphones', 'Plombier : 01 23 45 67 89' || chr(10) || 'Gardienne : 06 12 34 56 78' || chr(10) || 'Vétérinaire : 01 98 76 54 32');

  return hid;
end $$;

revoke all on function public.seed_demo(text, text) from public, anon, authenticated;
