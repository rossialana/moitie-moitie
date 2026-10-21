-- Moitié-Moitié : schéma, sécurité (RLS), fonctions et temps réel.
-- À exécuter une seule fois dans l'éditeur SQL de Supabase (ou via `supabase db push`).

-- ───────────────────────── Tables ─────────────────────────

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  color        text not null check (color in ('rose', 'bordeaux')),
  created_at   timestamptz not null default now(),
  unique (user_id)               -- un utilisateur = un seul foyer
);

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  title            text not null,
  frequency        text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly')),
  weekdays         smallint[] not null default '{}',   -- 0 = dimanche … 6 = samedi
  assignment_mode  text not null check (assignment_mode in ('fixed', 'rotating', 'together')),
  fixed_member_id  uuid references public.members(id) on delete set null,
  rotation_order   uuid[] not null default '{}',       -- ids de members, dans l'ordre
  start_date       date not null default current_date,
  reminder_time    time,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.task_occurrences (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.tasks(id) on delete cascade,
  household_id       uuid not null references public.households(id) on delete cascade,
  date               date not null,
  assigned_member_id uuid references public.members(id) on delete set null, -- null = ensemble
  completed          boolean not null default false,
  completed_by       uuid references public.members(id) on delete set null,
  completed_at       timestamptz,
  unique (task_id, date)
);

create table public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,                         -- Supermarché / Pharmacie / Pour la maison
  shopper_id   uuid references public.members(id) on delete set null, -- qui y va
  date         date,
  created_at   timestamptz not null default now()
);

create table public.pantry_products (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  name              text not null,
  category          text not null default 'Épicerie',
  duration_days     integer not null check (duration_days > 0),
  last_purchased_on date not null default current_date,
  created_at        timestamptz not null default now()
);

create table public.shopping_items (
  id                uuid primary key default gen_random_uuid(),
  list_id           uuid not null references public.shopping_lists(id) on delete cascade,
  household_id      uuid not null references public.households(id) on delete cascade,
  name              text not null,
  category          text not null default 'Autre',    -- Épicerie, Fruits et légumes, …
  quantity          text,
  requested_by      uuid references public.members(id) on delete set null,
  purchased         boolean not null default false,
  is_automatic      boolean not null default false,
  pantry_product_id uuid references public.pantry_products(id) on delete set null,
  created_at        timestamptz not null default now()
);
-- Un seul article automatique en attente par produit du garde-manger.
create unique index shopping_items_one_pending_per_product
  on public.shopping_items (pantry_product_id) where purchased = false and pantry_product_id is not null;

create table public.reminders (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  title              text not null,
  due_at             timestamptz not null,
  assigned_member_id uuid references public.members(id) on delete set null, -- null = les deux
  repeat             text not null default 'none' check (repeat in ('none', 'yearly', 'monthly')),
  notice_days        integer not null default 0 check (notice_days >= 0),
  note               text,
  created_at         timestamptz not null default now()
);

create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title        text not null default '',
  content      text not null default '',
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index on public.members (household_id);
create index on public.tasks (household_id);
create index on public.task_occurrences (household_id, date);
create index on public.shopping_lists (household_id);
create index on public.shopping_items (household_id);
create index on public.shopping_items (list_id);
create index on public.pantry_products (household_id);
create index on public.reminders (household_id);
create index on public.notes (household_id);

-- ───────────────────────── Sécurité (RLS) ─────────────────────────

-- security definer : évite la récursion des policies sur members.
create or replace function public.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where household_id = hid and user_id = auth.uid());
$$;

alter table public.households       enable row level security;
alter table public.members          enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_occurrences enable row level security;
alter table public.shopping_lists   enable row level security;
alter table public.shopping_items   enable row level security;
alter table public.pantry_products  enable row level security;
alter table public.reminders        enable row level security;
alter table public.notes            enable row level security;

-- Foyers : création et adhésion uniquement via les fonctions ci-dessous.
create policy "voir son foyer"      on public.households for select using (public.is_member(id));
create policy "modifier son foyer"  on public.households for update using (public.is_member(id)) with check (public.is_member(id));

create policy "voir les membres du foyer" on public.members for select using (public.is_member(household_id));
create policy "modifier son profil"       on public.members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "quitter le foyer"          on public.members for delete using (user_id = auth.uid());

-- Tables « simples » : tout membre du foyer peut lire et écrire.
do $$
declare t text;
begin
  foreach t in array array['tasks', 'shopping_lists', 'pantry_products', 'reminders', 'notes'] loop
    execute format(
      'create policy "membres du foyer" on public.%I for all
         using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
  end loop;
end $$;

-- Tables enfants : le parent doit appartenir au même foyer.
create policy "membres du foyer" on public.task_occurrences for all
  using (public.is_member(household_id))
  with check (
    public.is_member(household_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.household_id = task_occurrences.household_id)
  );

create policy "membres du foyer" on public.shopping_items for all
  using (public.is_member(household_id))
  with check (
    public.is_member(household_id)
    and exists (select 1 from public.shopping_lists l where l.id = list_id and l.household_id = shopping_items.household_id)
  );

-- ───────────────────────── Fonctions (RPC) ─────────────────────────

create or replace function public.create_household(p_name text, p_member_name text, p_color text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  hid  uuid;
  code text;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'Tu fais déjà partie d''un foyer';
  end if;
  if p_color not in ('rose', 'bordeaux') then raise exception 'Couleur invalide'; end if;

  loop
    -- Alphabet sans caractères ambigus (pas de 0/O, 1/I/L).
    code := (
      select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from households where invite_code = code);
  end loop;

  insert into households (name, invite_code) values (trim(p_name), code) returning id into hid;
  insert into members (household_id, user_id, name, color) values (hid, auth.uid(), trim(p_member_name), p_color);
  insert into shopping_lists (household_id, name) values
    (hid, 'Supermarché'), (hid, 'Pharmacie'), (hid, 'Pour la maison');
  return hid;
end $$;

create or replace function public.join_household(p_code text, p_member_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  hid         uuid;
  taken_color text;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'Tu fais déjà partie d''un foyer';
  end if;

  select id into hid from households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'Code d''invitation introuvable'; end if;
  if (select count(*) from members where household_id = hid) >= 2 then
    raise exception 'Ce foyer est déjà complet';
  end if;

  select color into taken_color from members where household_id = hid limit 1;
  insert into members (household_id, user_id, name, color)
  values (hid, auth.uid(), trim(p_member_name), case when taken_color = 'rose' then 'bordeaux' else 'rose' end);

  -- La personne qui rejoint entre aussi dans les rotations existantes.
  update tasks set rotation_order = rotation_order || (select id from members where user_id = auth.uid())
  where household_id = hid and assignment_mode = 'rotating';
  return hid;
end $$;

-- Nouveau code d'invitation (ex. si le lien a circulé).
create or replace function public.regenerate_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_member(p_household) then raise exception 'Accès refusé'; end if;
  loop
    code := (
      select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from households where invite_code = code);
  end loop;
  update households set invite_code = code where id = p_household;
  return code;
end $$;

revoke all on function public.create_household(text, text, text) from public, anon;
revoke all on function public.join_household(text, text)         from public, anon;
revoke all on function public.regenerate_invite_code(uuid)        from public, anon;
grant execute on function public.create_household(text, text, text) to authenticated;
grant execute on function public.join_household(text, text)         to authenticated;
grant execute on function public.regenerate_invite_code(uuid)        to authenticated;

-- Droits explicites : marche même si « Automatically expose new tables » est décoché.
-- Seuls les utilisateurs connectés y ont accès ; la RLS filtre ensuite par foyer.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.households, public.members, public.tasks, public.task_occurrences,
  public.shopping_lists, public.shopping_items, public.pantry_products,
  public.reminders, public.notes
to authenticated;
revoke all on
  public.households, public.members, public.tasks, public.task_occurrences,
  public.shopping_lists, public.shopping_items, public.pantry_products,
  public.reminders, public.notes
from anon;
grant execute on function public.is_member(uuid) to authenticated;

-- ───────────────────────── Temps réel ─────────────────────────

-- replica identity full : les DELETE envoient l'ancienne ligne (household_id inclus).
alter table public.households       replica identity full;
alter table public.members          replica identity full;
alter table public.tasks            replica identity full;
alter table public.task_occurrences replica identity full;
alter table public.shopping_lists   replica identity full;
alter table public.shopping_items   replica identity full;
alter table public.pantry_products  replica identity full;
alter table public.reminders        replica identity full;
alter table public.notes            replica identity full;

alter publication supabase_realtime add table
  public.households, public.members, public.tasks, public.task_occurrences,
  public.shopping_lists, public.shopping_items, public.pantry_products,
  public.reminders, public.notes;
