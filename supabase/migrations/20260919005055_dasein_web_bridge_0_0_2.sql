-- Dasein 0.0.2 — Web bridge sobre o banco existente do Aloca+
-- Migração aditiva: preserva profiles/equipments/classes/withdrawals/withdrawal_items/carts.

create extension if not exists btree_gist with schema extensions;

do $$ begin
  create type public.reservation_status as enum ('confirmed','cancelled','fulfilled','expired');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.maintenance_event_status as enum ('open','resolved','cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.reservations (
  id bigint generated always as identity primary key,
  equipment_id uuid not null references public.equipments(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  class_name text not null check (length(btrim(class_name)) between 1 and 120),
  destination text not null check (length(btrim(destination)) between 1 and 160),
  start_at timestamptz not null,
  end_at timestamptz not null,
  notes text check (notes is null or length(notes) <= 800),
  status public.reservation_status not null default 'confirmed',
  withdrawal_id bigint unique references public.withdrawals(id) on delete set null,
  client_action_id uuid not null unique,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  fulfilled_at timestamptz,
  check (end_at > start_at)
);

create index if not exists reservations_user_start_idx
  on public.reservations(user_id, start_at desc);
create index if not exists reservations_equipment_start_idx
  on public.reservations(equipment_id, start_at desc);
create index if not exists reservations_active_start_idx
  on public.reservations(start_at)
  where status='confirmed'::public.reservation_status;

do $$ begin
  alter table public.reservations
    add constraint reservations_no_active_overlap
    exclude using gist (
      equipment_id with =,
      tstzrange(start_at,end_at,'[)') with &&
    ) where (status='confirmed'::public.reservation_status);
exception when duplicate_object then null;
end $$;

alter table public.reservations enable row level security;

drop policy if exists reservations_select_by_role on public.reservations;
create policy reservations_select_by_role
on public.reservations for select
to authenticated
using (
  user_id=(select auth.uid())
  or (select private.current_role())='admin'::public.app_role
);

revoke all on table public.reservations from anon, authenticated;
grant select on table public.reservations to authenticated;

create table if not exists public.maintenance_events (
  id bigint generated always as identity primary key,
  equipment_id uuid not null references public.equipments(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 160),
  notes text check (notes is null or length(notes) <= 1200),
  resolution text check (resolution is null or length(resolution) <= 1200),
  status public.maintenance_event_status not null default 'open',
  client_action_id uuid not null unique,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists maintenance_one_open_per_equipment_idx
  on public.maintenance_events(equipment_id)
  where status='open'::public.maintenance_event_status;
create index if not exists maintenance_equipment_opened_idx
  on public.maintenance_events(equipment_id, opened_at desc);

alter table public.maintenance_events enable row level security;

drop policy if exists maintenance_events_select_admin on public.maintenance_events;
create policy maintenance_events_select_admin
on public.maintenance_events for select
to authenticated
using ((select private.current_role())='admin'::public.app_role);

revoke all on table public.maintenance_events from anon, authenticated;
grant select on table public.maintenance_events to authenticated;

-- QR público: só retorna metadados operacionais mínimos. O QR contém apenas qr_token.
create or replace function private.scan_qr_internal(p_token uuid)
returns table(
  kind text,
  qr_token uuid,
  display_name text,
  code text,
  asset_tag text,
  brand text,
  model text,
  status public.equipment_status,
  item_count bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  return query
  select
    'equipment'::text,
    e.qr_token,
    coalesce(nullif(btrim(e.label),''),e.code),
    e.code,
    e.asset_tag,
    e.brand,
    e.model,
    e.status,
    null::bigint
  from public.equipments e
  where e.qr_token=p_token and e.is_active
  limit 1;

  if found then return; end if;

  return query
  select
    'cart'::text,
    c.qr_token,
    coalesce(nullif(btrim(c.name),''),'Carrinho '||c.number::text),
    c.number::text,
    null::text,
    null::text,
    null::text,
    null::public.equipment_status,
    count(ci.equipment_id)::bigint
  from public.equipment_carts c
  left join public.equipment_cart_items ci on ci.cart_id=c.id
  where c.qr_token=p_token and c.is_active
  group by c.id
  limit 1;
end;
$$;

revoke all on function private.scan_qr_internal(uuid) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.scan_qr_internal(uuid) to anon, authenticated;

create or replace function public.scan_qr(p_token uuid)
returns table(
  kind text,
  qr_token uuid,
  display_name text,
  code text,
  asset_tag text,
  brand text,
  model text,
  status public.equipment_status,
  item_count bigint
)
language sql
stable
set search_path=''
as $$ select * from private.scan_qr_internal(p_token); $$;

revoke all on function public.scan_qr(uuid) from public;
grant execute on function public.scan_qr(uuid) to anon, authenticated;

-- Reservas futuras reais, sem duplicar dados do equipamento.
create or replace function private.create_reservation_internal(
  p_equipment_id uuid,
  p_class_name text,
  p_destination text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_notes text,
  p_client_action_id uuid
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_role public.app_role;
  v_id bigint;
  v_status public.equipment_status;
  v_active boolean;
begin
  if v_uid is null then raise exception 'DASEIN_NOT_AUTHENTICATED'; end if;
  if p_client_action_id is null then raise exception 'DASEIN_ACTION_ID_REQUIRED'; end if;

  select r.id into v_id
  from public.reservations r
  where r.client_action_id=p_client_action_id and r.user_id=v_uid
  limit 1;
  if v_id is not null then return v_id; end if;

  select private.current_role() into v_role;
  if v_role is null then raise exception 'DASEIN_PROFILE_NOT_FOUND'; end if;
  if nullif(btrim(p_class_name),'') is null then raise exception 'DASEIN_CLASS_REQUIRED'; end if;
  if nullif(btrim(p_destination),'') is null then raise exception 'DASEIN_DESTINATION_REQUIRED'; end if;
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at then raise exception 'DASEIN_RESERVATION_TIME_INVALID'; end if;
  if p_start_at < now()-interval '5 minutes' then raise exception 'DASEIN_RESERVATION_PAST'; end if;

  select e.status,e.is_active into v_status,v_active
  from public.equipments e
  where e.id=p_equipment_id
  for update;

  if not found then raise exception 'DASEIN_EQUIPMENT_NOT_FOUND'; end if;
  if not v_active or v_status='unavailable'::public.equipment_status then raise exception 'DASEIN_EQUIPMENT_UNAVAILABLE'; end if;
  if v_status='maintenance'::public.equipment_status then raise exception 'DASEIN_EQUIPMENT_MAINTENANCE'; end if;

  insert into public.reservations(
    equipment_id,user_id,class_name,destination,start_at,end_at,notes,status,client_action_id
  ) values(
    p_equipment_id,v_uid,btrim(p_class_name),btrim(p_destination),p_start_at,p_end_at,
    nullif(btrim(p_notes),''),'confirmed'::public.reservation_status,p_client_action_id
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then raise exception 'DASEIN_RESERVATION_CONFLICT';
  when unique_violation then
    select r.id into v_id from public.reservations r
    where r.client_action_id=p_client_action_id and r.user_id=v_uid limit 1;
    if v_id is not null then return v_id; end if;
    raise;
end;
$$;

revoke all on function private.create_reservation_internal(uuid,text,text,timestamptz,timestamptz,text,uuid) from public;
grant execute on function private.create_reservation_internal(uuid,text,text,timestamptz,timestamptz,text,uuid) to authenticated;

create or replace function public.create_reservation(
  p_equipment_id uuid,
  p_class_name text,
  p_destination text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_notes text,
  p_client_action_id uuid
)
returns text
language sql
set search_path=''
as $$ select private.create_reservation_internal(p_equipment_id,p_class_name,p_destination,p_start_at,p_end_at,p_notes,p_client_action_id)::text; $$;
revoke all on function public.create_reservation(uuid,text,text,timestamptz,timestamptz,text,uuid) from public;
grant execute on function public.create_reservation(uuid,text,text,timestamptz,timestamptz,text,uuid) to authenticated;

create or replace function private.cancel_reservation_internal(p_reservation_id bigint)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_owner uuid;
  v_status public.reservation_status;
begin
  if v_uid is null then raise exception 'DASEIN_NOT_AUTHENTICATED'; end if;

  select r.user_id,r.status into v_owner,v_status
  from public.reservations r
  where r.id=p_reservation_id
  for update;
  if not found then raise exception 'DASEIN_RESERVATION_NOT_FOUND'; end if;

  if v_owner<>v_uid and private.current_role()<>'admin'::public.app_role then
    raise exception 'DASEIN_FORBIDDEN';
  end if;
  if v_status<>'confirmed'::public.reservation_status then return p_reservation_id; end if;

  update public.reservations
  set status='cancelled'::public.reservation_status,cancelled_at=now()
  where id=p_reservation_id;
  return p_reservation_id;
end;
$$;
revoke all on function private.cancel_reservation_internal(bigint) from public;
grant execute on function private.cancel_reservation_internal(bigint) to authenticated;

create or replace function public.cancel_reservation(p_reservation_id bigint)
returns text
language sql
set search_path=''
as $$ select private.cancel_reservation_internal(p_reservation_id)::text; $$;
revoke all on function public.cancel_reservation(bigint) from public;
grant execute on function public.cancel_reservation(bigint) to authenticated;

create or replace function private.checkout_reservation_internal(p_reservation_id bigint,p_client_action_id uuid)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_r public.reservations%rowtype;
  v_withdrawal_id bigint;
begin
  if v_uid is null then raise exception 'DASEIN_NOT_AUTHENTICATED'; end if;
  if p_client_action_id is null then raise exception 'DASEIN_ACTION_ID_REQUIRED'; end if;

  select * into v_r from public.reservations where id=p_reservation_id for update;
  if not found then raise exception 'DASEIN_RESERVATION_NOT_FOUND'; end if;
  if v_r.user_id<>v_uid then raise exception 'DASEIN_RESERVATION_OWNER_REQUIRED'; end if;
  if v_r.status='fulfilled'::public.reservation_status and v_r.withdrawal_id is not null then return v_r.withdrawal_id; end if;
  if v_r.status<>'confirmed'::public.reservation_status then raise exception 'DASEIN_RESERVATION_NOT_ACTIVE'; end if;
  if now() < v_r.start_at-interval '30 minutes' then raise exception 'DASEIN_RESERVATION_TOO_EARLY'; end if;
  if now() >= v_r.end_at then raise exception 'DASEIN_RESERVATION_EXPIRED'; end if;

  v_withdrawal_id:=private.checkout_equipment_internal_v2(
    v_r.equipment_id,v_r.class_name,v_r.destination,null,p_client_action_id
  );

  update public.reservations
  set status='fulfilled'::public.reservation_status,
      fulfilled_at=now(),
      withdrawal_id=v_withdrawal_id
  where id=v_r.id;

  return v_withdrawal_id;
end;
$$;
revoke all on function private.checkout_reservation_internal(bigint,uuid) from public;
grant execute on function private.checkout_reservation_internal(bigint,uuid) to authenticated;

create or replace function public.checkout_reservation(p_reservation_id bigint,p_client_action_id uuid)
returns text
language sql
set search_path=''
as $$ select private.checkout_reservation_internal(p_reservation_id,p_client_action_id)::text; $$;
revoke all on function public.checkout_reservation(bigint,uuid) from public;
grant execute on function public.checkout_reservation(bigint,uuid) to authenticated;

-- Manutenção simples e histórica. Só admin nesta fase para preservar os papéis do app.
create or replace function private.open_maintenance_internal(
  p_equipment_id uuid,p_title text,p_notes text,p_client_action_id uuid
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_id bigint;
  v_status public.equipment_status;
  v_active boolean;
begin
  if v_uid is null then raise exception 'DASEIN_NOT_AUTHENTICATED'; end if;
  if private.current_role()<>'admin'::public.app_role then raise exception 'DASEIN_ADMIN_REQUIRED'; end if;
  if p_client_action_id is null then raise exception 'DASEIN_ACTION_ID_REQUIRED'; end if;
  if nullif(btrim(p_title),'') is null then raise exception 'DASEIN_MAINTENANCE_TITLE_REQUIRED'; end if;

  select m.id into v_id from public.maintenance_events m
  where m.client_action_id=p_client_action_id limit 1;
  if v_id is not null then return v_id; end if;

  select e.status,e.is_active into v_status,v_active
  from public.equipments e where e.id=p_equipment_id for update;
  if not found then raise exception 'DASEIN_EQUIPMENT_NOT_FOUND'; end if;
  if not v_active or v_status='unavailable'::public.equipment_status then raise exception 'DASEIN_EQUIPMENT_UNAVAILABLE'; end if;
  if v_status='in_use'::public.equipment_status then raise exception 'DASEIN_EQUIPMENT_IN_USE'; end if;

  insert into public.maintenance_events(equipment_id,opened_by,title,notes,client_action_id)
  values(p_equipment_id,v_uid,btrim(p_title),nullif(btrim(p_notes),''),p_client_action_id)
  returning id into v_id;

  update public.equipments set status='maintenance'::public.equipment_status where id=p_equipment_id;
  return v_id;
exception
  when unique_violation then raise exception 'DASEIN_MAINTENANCE_ALREADY_OPEN';
end;
$$;
revoke all on function private.open_maintenance_internal(uuid,text,text,uuid) from public;
grant execute on function private.open_maintenance_internal(uuid,text,text,uuid) to authenticated;

create or replace function public.open_maintenance(p_equipment_id uuid,p_title text,p_notes text,p_client_action_id uuid)
returns text
language sql
set search_path=''
as $$ select private.open_maintenance_internal(p_equipment_id,p_title,p_notes,p_client_action_id)::text; $$;
revoke all on function public.open_maintenance(uuid,text,text,uuid) from public;
grant execute on function public.open_maintenance(uuid,text,text,uuid) to authenticated;

create or replace function private.resolve_maintenance_internal(p_event_id bigint,p_resolution text)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_equipment_id uuid;
  v_status public.maintenance_event_status;
begin
  if auth.uid() is null then raise exception 'DASEIN_NOT_AUTHENTICATED'; end if;
  if private.current_role()<>'admin'::public.app_role then raise exception 'DASEIN_ADMIN_REQUIRED'; end if;

  select m.equipment_id,m.status into v_equipment_id,v_status
  from public.maintenance_events m where m.id=p_event_id for update;
  if not found then raise exception 'DASEIN_MAINTENANCE_NOT_FOUND'; end if;
  if v_status<>'open'::public.maintenance_event_status then return p_event_id; end if;

  perform 1 from public.equipments e where e.id=v_equipment_id for update;
  update public.maintenance_events
  set status='resolved'::public.maintenance_event_status,
      resolution=nullif(btrim(p_resolution),''),closed_at=now()
  where id=p_event_id;
  update public.equipments
  set status=case when is_active then 'available'::public.equipment_status else 'unavailable'::public.equipment_status end
  where id=v_equipment_id;
  return p_event_id;
end;
$$;
revoke all on function private.resolve_maintenance_internal(bigint,text) from public;
grant execute on function private.resolve_maintenance_internal(bigint,text) to authenticated;

create or replace function public.resolve_maintenance(p_event_id bigint,p_resolution text default null)
returns text
language sql
set search_path=''
as $$ select private.resolve_maintenance_internal(p_event_id,p_resolution)::text; $$;
revoke all on function public.resolve_maintenance(bigint,text) from public;
grant execute on function public.resolve_maintenance(bigint,text) to authenticated;

-- Capacidade do banco: apenas admin, sem service_role no navegador.
create or replace function private.admin_capacity_status_internal()
returns table(
  database_bytes bigint,
  database_mb numeric,
  percent_of_free_limit numeric,
  policy_state text,
  free_limit_mb integer,
  prepare_mb integer,
  archive_mb integer,
  purge_mb integer
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'DASEIN_NOT_AUTHENTICATED'; end if;
  if private.current_role()<>'admin'::public.app_role then raise exception 'DASEIN_ADMIN_REQUIRED'; end if;
  return query
  with usage as (select pg_database_size(current_database())::bigint as bytes)
  select bytes,
         round(bytes/1024.0/1024.0,2),
         round((bytes/1024.0/1024.0)/500.0*100.0,2),
         case when bytes/1024.0/1024.0<400 then 'normal'
              when bytes/1024.0/1024.0<425 then 'prepare'
              when bytes/1024.0/1024.0<450 then 'archive'
              else 'purge' end,
         500,400,425,450
  from usage;
end;
$$;
revoke all on function private.admin_capacity_status_internal() from public;
grant execute on function private.admin_capacity_status_internal() to authenticated;

create or replace function public.admin_capacity_status()
returns table(
  database_bytes bigint,
  database_mb numeric,
  percent_of_free_limit numeric,
  policy_state text,
  free_limit_mb integer,
  prepare_mb integer,
  archive_mb integer,
  purge_mb integer
)
language sql
stable
set search_path=''
as $$ select * from private.admin_capacity_status_internal(); $$;
revoke all on function public.admin_capacity_status() from public;
grant execute on function public.admin_capacity_status() to authenticated;
