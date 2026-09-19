-- Dasein 0.0.1 — Fundação do banco
-- Execute uma vez no SQL Editor de um projeto Supabase novo.
-- Não contém chaves, senhas ou segredos.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
grant usage on schema private to supabase_auth_admin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create type public.user_role as enum ('student', 'teacher', 'staff', 'admin');
create type public.equipment_status as enum ('available', 'reserved', 'in_use', 'maintenance', 'inactive');
create type public.reservation_status as enum ('pending', 'confirmed', 'cancelled', 'completed', 'expired');
create type public.movement_action as enum ('checkout', 'return');
create type public.maintenance_status as enum ('open', 'analysis', 'in_progress', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role public.user_role not null default 'student',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  asset_number text not null unique,
  name text,
  category text,
  manufacturer text,
  model text,
  serial_number text,
  location text,
  status public.equipment_status not null default 'available',
  notes text,
  allow_student_checkout boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(public_id) between 6 and 32),
  check (char_length(asset_number) between 1 and 80),
  check (name is null or char_length(name) <= 120),
  check (notes is null or char_length(notes) <= 1000)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  user_id uuid not null references public.profiles(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  purpose text,
  status public.reservation_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (purpose is null or char_length(purpose) <= 300)
);

alter table public.reservations
  add constraint reservations_no_active_overlap
  exclude using gist (
    equipment_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('pending', 'confirmed'));

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  user_id uuid not null references public.profiles(id),
  performed_by uuid not null references public.profiles(id),
  reservation_id uuid references public.reservations(id),
  action public.movement_action not null,
  condition text,
  notes text,
  occurred_at timestamptz not null default now(),
  check (condition is null or char_length(condition) <= 120),
  check (notes is null or char_length(notes) <= 1000)
);

create table public.maintenance (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  opened_by uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  title text not null,
  description text,
  status public.maintenance_status not null default 'open',
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (char_length(title) between 2 and 160),
  check (description is null or char_length(description) <= 4000)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.term_versions (
  version text primary key,
  title text not null,
  active boolean not null default false,
  published_at timestamptz not null default now()
);

create unique index term_versions_one_active_idx
  on public.term_versions ((active))
  where active = true;

create table public.term_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  version text not null references public.term_versions(version),
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);

insert into public.term_versions (version, title, active)
values ('0.1.0', 'Termos e Privacidade — versão preliminar', true);

-- Índices de consultas frequentes.
create index equipment_status_idx on public.equipment(status) where active = true;
create index equipment_location_idx on public.equipment(location) where active = true;
create index equipment_model_idx on public.equipment(model) where active = true;
create index reservations_user_idx on public.reservations(user_id, start_at desc);
create index reservations_equipment_idx on public.reservations(equipment_id, start_at desc);
create index movements_user_idx on public.movements(user_id, occurred_at desc);
create index movements_equipment_idx on public.movements(equipment_id, occurred_at desc);
create index maintenance_equipment_idx on public.maintenance(equipment_id, opened_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

-- Funções internas.
create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true
  limit 1;
$$;
revoke all on function private.current_role() from public;
grant execute on function private.current_role() to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public;
grant execute on function private.set_updated_at() to authenticated;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger equipment_set_updated_at before update on public.equipment
for each row execute function private.set_updated_at();
create trigger reservations_set_updated_at before update on public.reservations
for each row execute function private.set_updated_at();
create trigger maintenance_set_updated_at before update on public.maintenance
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;
grant execute on function private.handle_new_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.audit_equipment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
  v_entity uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'equipment.created';
    v_entity := new.id;
  elsif tg_op = 'UPDATE' then
    v_action := 'equipment.updated';
    v_entity := new.id;
  else
    v_action := 'equipment.deleted';
    v_entity := old.id;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    v_action,
    'equipment',
    v_entity,
    jsonb_build_object('operation', tg_op)
  );

  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_equipment_change() from public;
grant execute on function private.audit_equipment_change() to authenticated;

create trigger equipment_audit
after insert or update or delete on public.equipment
for each row execute function private.audit_equipment_change();

-- Endpoint público mínimo para QR sem sessão.
create or replace function public.get_public_equipment(p_public_id text)
returns table (
  public_id text,
  asset_number text,
  display_name text,
  model text,
  category text,
  status public.equipment_status
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.public_id,
    e.asset_number,
    coalesce(e.name, e.model, 'Equipamento') as display_name,
    e.model,
    e.category,
    e.status
  from public.equipment e
  where e.public_id = upper(trim(p_public_id))
    and e.active = true
  limit 1;
$$;
revoke all on function public.get_public_equipment(text) from public;
grant execute on function public.get_public_equipment(text) to anon, authenticated;

-- Retirada atômica. A função trava a linha do equipamento antes de decidir.
create or replace function public.checkout_equipment(
  p_equipment_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_role public.user_role;
  v_equipment public.equipment%rowtype;
  v_reservation uuid;
  v_movement uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_role := private.current_role();
  if v_role is null then
    raise exception 'ACCOUNT_INACTIVE';
  end if;

  select * into v_equipment
  from public.equipment
  where id = p_equipment_id and active = true
  for update;

  if not found then
    raise exception 'EQUIPMENT_NOT_FOUND';
  end if;

  if v_equipment.status not in ('available', 'reserved') then
    raise exception 'EQUIPMENT_UNAVAILABLE';
  end if;

  if v_role = 'student' and not v_equipment.allow_student_checkout then
    raise exception 'STUDENT_CHECKOUT_NOT_ALLOWED';
  end if;

  select r.id into v_reservation
  from public.reservations r
  where r.equipment_id = p_equipment_id
    and r.user_id = v_user
    and r.status in ('pending', 'confirmed')
    and now() >= r.start_at - interval '15 minutes'
    and now() < r.end_at
  order by r.start_at
  limit 1;

  if v_equipment.status = 'reserved'
     and v_reservation is null
     and v_role not in ('admin', 'staff') then
    raise exception 'RESERVATION_REQUIRED';
  end if;

  update public.equipment
  set status = 'in_use'
  where id = p_equipment_id;

  insert into public.movements(
    equipment_id, user_id, performed_by, reservation_id, action, notes
  ) values (
    p_equipment_id, v_user, v_user, v_reservation, 'checkout', nullif(trim(p_notes), '')
  ) returning id into v_movement;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (v_user, 'equipment.checkout', 'equipment', p_equipment_id, jsonb_build_object('movement_id', v_movement));

  return v_movement;
end;
$$;
revoke all on function public.checkout_equipment(uuid, text) from public;
grant execute on function public.checkout_equipment(uuid, text) to authenticated;

-- Devolução atômica. Usuário comum só devolve o equipamento cuja última retirada foi dele.
create or replace function public.return_equipment(
  p_equipment_id uuid,
  p_condition text default 'Normal',
  p_notes text default null,
  p_send_to_maintenance boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_role public.user_role;
  v_equipment public.equipment%rowtype;
  v_last_checkout_user uuid;
  v_movement uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_role := private.current_role();
  if v_role is null then
    raise exception 'ACCOUNT_INACTIVE';
  end if;

  select * into v_equipment
  from public.equipment
  where id = p_equipment_id and active = true
  for update;

  if not found then
    raise exception 'EQUIPMENT_NOT_FOUND';
  end if;

  if v_equipment.status <> 'in_use' then
    raise exception 'EQUIPMENT_NOT_IN_USE';
  end if;

  select m.user_id into v_last_checkout_user
  from public.movements m
  where m.equipment_id = p_equipment_id and m.action = 'checkout'
  order by m.occurred_at desc
  limit 1;

  if v_role not in ('admin', 'staff') and v_last_checkout_user is distinct from v_user then
    raise exception 'RETURN_NOT_ALLOWED';
  end if;

  update public.equipment
  set status = case when p_send_to_maintenance then 'maintenance'::public.equipment_status else 'available'::public.equipment_status end
  where id = p_equipment_id;

  insert into public.movements(
    equipment_id, user_id, performed_by, action, condition, notes
  ) values (
    p_equipment_id, coalesce(v_last_checkout_user, v_user), v_user, 'return', nullif(trim(p_condition), ''), nullif(trim(p_notes), '')
  ) returning id into v_movement;

  if p_send_to_maintenance then
    insert into public.maintenance(equipment_id, opened_by, title, description, status)
    values (p_equipment_id, v_user, 'Manutenção aberta na devolução', nullif(trim(p_notes), ''), 'open');
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (v_user, 'equipment.return', 'equipment', p_equipment_id, jsonb_build_object('movement_id', v_movement, 'maintenance', p_send_to_maintenance));

  return v_movement;
end;
$$;
revoke all on function public.return_equipment(uuid, text, text, boolean) from public;
grant execute on function public.return_equipment(uuid, text, text, boolean) to authenticated;

-- RLS: todas as tabelas expostas ficam protegidas.
alter table public.profiles enable row level security;
alter table public.equipment enable row level security;
alter table public.reservations enable row level security;
alter table public.movements enable row level security;
alter table public.maintenance enable row level security;
alter table public.audit_logs enable row level security;
alter table public.term_versions enable row level security;
alter table public.term_acceptances enable row level security;

create policy profiles_select_own_or_admin
on public.profiles for select
to authenticated
using ((select auth.uid()) = id or private.current_role() = 'admin');

create policy profiles_update_admin
on public.profiles for update
to authenticated
using (private.current_role() = 'admin')
with check (private.current_role() = 'admin');

create policy equipment_select_authenticated
on public.equipment for select
to authenticated
using (active = true or private.current_role() = 'admin');

create policy equipment_insert_admin
on public.equipment for insert
to authenticated
with check (private.current_role() = 'admin');

create policy equipment_update_admin
on public.equipment for update
to authenticated
using (private.current_role() = 'admin')
with check (private.current_role() = 'admin');

create policy reservations_select_own_or_ops
on public.reservations for select
to authenticated
using ((select auth.uid()) = user_id or private.current_role() in ('admin', 'staff'));

create policy reservations_insert_own
on public.reservations for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy movements_select_own_or_ops
on public.movements for select
to authenticated
using ((select auth.uid()) = user_id or private.current_role() in ('admin', 'staff'));

create policy maintenance_select_ops
on public.maintenance for select
to authenticated
using (private.current_role() in ('admin', 'staff'));

create policy maintenance_insert_ops
on public.maintenance for insert
to authenticated
with check (private.current_role() in ('admin', 'staff'));

create policy maintenance_update_ops
on public.maintenance for update
to authenticated
using (private.current_role() in ('admin', 'staff'))
with check (private.current_role() in ('admin', 'staff'));

create policy audit_select_admin
on public.audit_logs for select
to authenticated
using (private.current_role() = 'admin');

create policy terms_select_public
on public.term_versions for select
to anon, authenticated
using (active = true);

create policy term_acceptances_select_own_or_admin
on public.term_acceptances for select
to authenticated
using ((select auth.uid()) = user_id or private.current_role() = 'admin');

create policy term_acceptances_insert_own
on public.term_acceptances for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.term_versions tv
    where tv.version = term_acceptances.version and tv.active = true
  )
);

-- Grants explícitos para a Data API atual do Supabase.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.equipment from anon, authenticated;
revoke all on table public.reservations from anon, authenticated;
revoke all on table public.movements from anon, authenticated;
revoke all on table public.maintenance from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;
revoke all on table public.term_versions from anon, authenticated;
revoke all on table public.term_acceptances from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.equipment to authenticated;
grant select, insert on table public.reservations to authenticated;
grant select on table public.movements to authenticated;
grant select, insert, update on table public.maintenance to authenticated;
grant select on table public.audit_logs to authenticated;
grant select on table public.term_versions to anon, authenticated;
grant select, insert on table public.term_acceptances to authenticated;

-- Depois de criar sua própria conta pelo site, promova somente o primeiro ADM manualmente:
-- update public.profiles set role = 'admin' where id = 'UUID_DO_SEU_USUARIO';
