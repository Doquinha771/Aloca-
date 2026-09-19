-- Equipa 0.0.13 — hardening, inventário escolar, auditoria e operações administrativas.
-- Migration correspondente ao backend já aplicado no projeto Supabase.

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists disabled_at timestamptz;

alter table public.equipments
  add column if not exists school_group text,
  add column if not exists serial_number text,
  add column if not exists location_text text,
  add column if not exists notes text;

alter table public.equipment_carts
  add column if not exists location_text text,
  add column if not exists capacity integer,
  add column if not exists notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='equipments_school_group_check') then
    alter table public.equipments add constraint equipments_school_group_check
      check (school_group is null or school_group in (
        'chromebook','positivo_novo','positivo_tecnico','positivo_antigo',
        'thinkpad_lenovo','tablet','outro'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname='equipment_carts_capacity_check') then
    alter table public.equipment_carts add constraint equipment_carts_capacity_check
      check (capacity is null or (capacity >= 1 and capacity <= 200));
  end if;
end $$;

create unique index if not exists equipments_serial_number_unique
  on public.equipments (serial_number)
  where serial_number is not null and btrim(serial_number) <> '';
create index if not exists equipments_school_group_idx on public.equipments (school_group);
create index if not exists equipments_location_text_idx on public.equipments (location_text);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    'student'::public.app_role,
    false
  );
  return new;
end;
$$;

create or replace function private."current_role"()
returns public.app_role
language sql
stable
security definer
set search_path=''
as $$
  select p.role from public.profiles p
  where p.id=(select auth.uid()) and p.is_active=true
  limit 1;
$$;

drop policy if exists equipments_select_authenticated on public.equipments;
create policy equipments_select_authenticated on public.equipments
for select to authenticated
using (private."current_role"() is not null);

drop policy if exists equipment_carts_select on public.equipment_carts;
create policy equipment_carts_select on public.equipment_carts
for select to authenticated
using (private."current_role"() is not null and (is_active or private."current_role"()='admin'::public.app_role));

drop policy if exists equipment_cart_items_select on public.equipment_cart_items;
create policy equipment_cart_items_select on public.equipment_cart_items
for select to authenticated
using (
  private."current_role"() is not null
  and exists (
    select 1 from public.equipment_carts c
    where c.id=equipment_cart_items.cart_id
      and (c.is_active or private."current_role"()='admin'::public.app_role)
  )
);

drop policy if exists withdrawals_select_by_role on public.withdrawals;
create policy withdrawals_select_by_role on public.withdrawals
for select to authenticated
using (
  private."current_role"() is not null and (
    requested_by=(select auth.uid())
    or private."current_role"()='admin'::public.app_role
    or (
      private."current_role"()='student'::public.app_role
      and lower(coalesce(student_name,''))=lower(coalesce(private.current_full_name(),''))
      and nullif(btrim(coalesce(student_name,'')),'') is not null
    )
  )
);

drop policy if exists reservations_select_by_role on public.reservations;
create policy reservations_select_by_role on public.reservations
for select to authenticated
using (
  private."current_role"() is not null
  and (user_id=(select auth.uid()) or private."current_role"()='admin'::public.app_role)
);

create or replace function private.checkout_equipment_internal_v2(
  p_equipment_id uuid, p_class_name text, p_destination text,
  p_student_name text, p_client_action_id uuid
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_responsible text;
  v_profile_active boolean;
  v_status public.equipment_status;
  v_is_active boolean;
  v_withdrawal_id bigint;
  v_student text;
begin
  if v_user_id is null then raise exception 'ALOCA_NOT_AUTHENTICATED'; end if;
  if p_client_action_id is null then raise exception 'ALOCA_ACTION_ID_REQUIRED'; end if;

  select w.id into v_withdrawal_id from public.withdrawals w
  where w.client_action_id=p_client_action_id and w.requested_by=v_user_id limit 1;
  if v_withdrawal_id is not null then return v_withdrawal_id; end if;

  select p.role,p.full_name,p.is_active into v_role,v_responsible,v_profile_active
  from public.profiles p where p.id=v_user_id;
  if v_role is null then raise exception 'ALOCA_PROFILE_NOT_FOUND'; end if;
  if not coalesce(v_profile_active,false) then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
  if nullif(btrim(p_class_name),'') is null then raise exception 'ALOCA_CLASS_REQUIRED'; end if;
  if nullif(btrim(p_destination),'') is null then raise exception 'ALOCA_DESTINATION_REQUIRED'; end if;

  v_student := case when v_role='student'::public.app_role then nullif(btrim(v_responsible),'') else nullif(btrim(p_student_name),'') end;

  select e.status,e.is_active into v_status,v_is_active
  from public.equipments e where e.id=p_equipment_id for update;
  if not found then raise exception 'ALOCA_EQUIPMENT_NOT_FOUND'; end if;
  if not v_is_active or v_status='unavailable'::public.equipment_status then raise exception 'ALOCA_EQUIPMENT_UNAVAILABLE'; end if;
  if v_status='maintenance'::public.equipment_status then raise exception 'ALOCA_EQUIPMENT_MAINTENANCE'; end if;
  if v_status='in_use'::public.equipment_status then raise exception 'ALOCA_ALREADY_IN_USE'; end if;
  if v_status<>'available'::public.equipment_status then raise exception 'ALOCA_NOT_AVAILABLE'; end if;

  insert into public.withdrawals(requested_by,class_name,destination,responsible_name,student_name,status,withdrawn_at,client_action_id)
  values(v_user_id,btrim(p_class_name),btrim(p_destination),coalesce(nullif(btrim(v_responsible),''),'Responsável'),v_student,'open'::public.withdrawal_status,now(),p_client_action_id)
  returning id into v_withdrawal_id;

  insert into public.withdrawal_items(withdrawal_id,equipment_id) values(v_withdrawal_id,p_equipment_id);
  update public.equipments set status='in_use'::public.equipment_status,is_active=true where id=p_equipment_id;
  return v_withdrawal_id;
exception
  when unique_violation then
    select w.id into v_withdrawal_id from public.withdrawals w
    where w.client_action_id=p_client_action_id and w.requested_by=v_user_id limit 1;
    if v_withdrawal_id is not null then return v_withdrawal_id; end if;
    raise exception 'ALOCA_ALREADY_IN_USE';
end;
$$;

create or replace function private.checkout_batch_internal_v2(
  p_equipment_ids uuid[], p_class_name text, p_destination text, p_client_action_id uuid
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_responsible text;
  v_profile_active boolean;
  v_withdrawal_id bigint;
  v_requested integer;
  v_found integer;
  v_distinct integer;
  v_bad_code text;
begin
  if v_user_id is null then raise exception 'ALOCA_NOT_AUTHENTICATED'; end if;
  if p_client_action_id is null then raise exception 'ALOCA_ACTION_ID_REQUIRED'; end if;
  select w.id into v_withdrawal_id from public.withdrawals w
  where w.client_action_id=p_client_action_id and w.requested_by=v_user_id limit 1;
  if v_withdrawal_id is not null then return v_withdrawal_id; end if;

  select p.role,p.full_name,p.is_active into v_role,v_responsible,v_profile_active from public.profiles p where p.id=v_user_id;
  if v_role is null then raise exception 'ALOCA_PROFILE_NOT_FOUND'; end if;
  if not coalesce(v_profile_active,false) then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
  if nullif(btrim(p_class_name),'') is null then raise exception 'ALOCA_CLASS_REQUIRED'; end if;
  if nullif(btrim(p_destination),'') is null then raise exception 'ALOCA_DESTINATION_REQUIRED'; end if;

  v_requested:=coalesce(array_length(p_equipment_ids,1),0);
  if v_requested=0 then raise exception 'ALOCA_BATCH_EMPTY'; end if;
  if v_requested>60 then raise exception 'ALOCA_BATCH_TOO_LARGE'; end if;
  select count(distinct x) into v_distinct from unnest(p_equipment_ids) x;
  if v_distinct<>v_requested then raise exception 'ALOCA_BATCH_DUPLICATE'; end if;

  perform e.id from public.equipments e where e.id=any(p_equipment_ids) order by e.id for update;
  select count(*) into v_found from public.equipments e where e.id=any(p_equipment_ids);
  if v_found<>v_requested then raise exception 'ALOCA_BATCH_NOT_FOUND'; end if;

  select e.code into v_bad_code from public.equipments e where e.id=any(p_equipment_ids) and e.status='in_use'::public.equipment_status order by e.code limit 1;
  if v_bad_code is not null then raise exception 'ALOCA_BATCH_IN_USE:%',v_bad_code; end if;
  select e.code into v_bad_code from public.equipments e where e.id=any(p_equipment_ids) and e.status='maintenance'::public.equipment_status order by e.code limit 1;
  if v_bad_code is not null then raise exception 'ALOCA_BATCH_MAINTENANCE:%',v_bad_code; end if;
  select e.code into v_bad_code from public.equipments e where e.id=any(p_equipment_ids) and (not e.is_active or e.status='unavailable'::public.equipment_status) order by e.code limit 1;
  if v_bad_code is not null then raise exception 'ALOCA_BATCH_UNAVAILABLE:%',v_bad_code; end if;

  insert into public.withdrawals(requested_by,class_name,destination,responsible_name,student_name,status,withdrawn_at,client_action_id)
  values(v_user_id,btrim(p_class_name),btrim(p_destination),coalesce(nullif(btrim(v_responsible),''),'Responsável'),case when v_role='student'::public.app_role then nullif(btrim(v_responsible),'') else null end,'open'::public.withdrawal_status,now(),p_client_action_id)
  returning id into v_withdrawal_id;

  insert into public.withdrawal_items(withdrawal_id,equipment_id)
  select v_withdrawal_id,e.id from public.equipments e where e.id=any(p_equipment_ids) order by e.code;
  update public.equipments set status='in_use'::public.equipment_status,is_active=true where id=any(p_equipment_ids);
  return v_withdrawal_id;
exception
  when unique_violation then
    select w.id into v_withdrawal_id from public.withdrawals w where w.client_action_id=p_client_action_id and w.requested_by=v_user_id limit 1;
    if v_withdrawal_id is not null then return v_withdrawal_id; end if;
    raise exception 'ALOCA_BATCH_CONFLICT';
end;
$$;

create or replace function private.return_equipment_internal_v2(p_equipment_id uuid,p_client_action_id uuid)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_profile_active boolean;
  v_item_id bigint;
  v_withdrawal_id bigint;
  v_pending integer;
begin
  if v_user_id is null then raise exception 'ALOCA_NOT_AUTHENTICATED'; end if;
  if p_client_action_id is null then raise exception 'ALOCA_ACTION_ID_REQUIRED'; end if;
  select wi.withdrawal_id into v_withdrawal_id from public.withdrawal_items wi where wi.return_action_id=p_client_action_id limit 1;
  if v_withdrawal_id is not null then return v_withdrawal_id; end if;

  select p.role,p.is_active into v_role,v_profile_active from public.profiles p where p.id=v_user_id;
  if v_role is null then raise exception 'ALOCA_PROFILE_NOT_FOUND'; end if;
  if not coalesce(v_profile_active,false) then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
  perform 1 from public.equipments e where e.id=p_equipment_id for update;
  if not found then raise exception 'ALOCA_EQUIPMENT_NOT_FOUND'; end if;

  select wi.id,w.id into v_item_id,v_withdrawal_id
  from public.withdrawal_items wi join public.withdrawals w on w.id=wi.withdrawal_id
  where wi.equipment_id=p_equipment_id and wi.returned_at is null and w.status='open'::public.withdrawal_status
    and (v_role in ('admin'::public.app_role,'teacher'::public.app_role) or w.requested_by=v_user_id)
  order by w.withdrawn_at desc limit 1 for update of wi,w;
  if v_item_id is null then raise exception 'ALOCA_NOT_IN_USE_OR_FORBIDDEN'; end if;

  update public.withdrawal_items set returned_at=now(),return_action_id=p_client_action_id where id=v_item_id;
  update public.equipments set status='available'::public.equipment_status,is_active=true where id=p_equipment_id;
  select count(*) into v_pending from public.withdrawal_items where withdrawal_id=v_withdrawal_id and returned_at is null;
  if v_pending=0 then update public.withdrawals set status='returned'::public.withdrawal_status,returned_at=now() where id=v_withdrawal_id; end if;
  return v_withdrawal_id;
exception
  when unique_violation then
    select wi.withdrawal_id into v_withdrawal_id from public.withdrawal_items wi where wi.return_action_id=p_client_action_id limit 1;
    if v_withdrawal_id is not null then return v_withdrawal_id; end if;
    raise;
end;
$$;

create or replace function private.admin_user_list_safe_internal()
returns table(id uuid,full_name text,role public.app_role,masked_email text,is_active boolean,banned_until timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'ALOCA_NOT_AUTHENTICATED'; end if;
  if private."current_role"()<>'admin'::public.app_role then raise exception 'ALOCA_ADMIN_REQUIRED'; end if;
  return query
  select p.id,p.full_name,p.role,
    case when u.email is null then '—' else left(split_part(u.email,'@',1),2)||repeat('*',least(5,greatest(2,length(split_part(u.email,'@',1))-2)))||'@'||split_part(u.email,'@',2) end,
    p.is_active,u.banned_until,p.created_at,p.updated_at
  from public.profiles p join auth.users u on u.id=p.id
  order by p.is_active desc,lower(coalesce(p.full_name,''));
end;
$$;

create or replace function public.admin_user_list_safe()
returns table(id uuid,full_name text,role public.app_role,masked_email text,is_active boolean,banned_until timestamptz,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path=''
as $$ select * from private.admin_user_list_safe_internal(); $$;

revoke execute on function public.admin_user_list() from public,anon,authenticated;
grant usage on schema private to authenticated;
revoke all on function private.admin_user_list_safe_internal() from public,anon;
grant execute on function private.admin_user_list_safe_internal() to authenticated;
revoke all on function public.admin_user_list_safe() from public,anon;
grant execute on function public.admin_user_list_safe() to authenticated;

create or replace function private.save_equipment_cart_v2_internal(
  p_cart_id bigint,p_number integer,p_name text,p_equipment_codes text[],p_location_text text,p_capacity integer,p_notes text
)
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_cart_id bigint;
begin
  v_cart_id := private.save_equipment_cart_internal(p_cart_id,p_number,p_name,p_equipment_codes);
  update public.equipment_carts set location_text=nullif(btrim(p_location_text),''),capacity=p_capacity,notes=nullif(btrim(p_notes),''),updated_at=now() where id=v_cart_id;
  return v_cart_id;
end;
$$;

create or replace function public.save_equipment_cart_v2(
  p_cart_id bigint,p_number integer,p_name text,p_equipment_codes text[],p_location_text text default null,p_capacity integer default null,p_notes text default null
)
returns text language sql security invoker set search_path=''
as $$ select private.save_equipment_cart_v2_internal(p_cart_id,p_number,p_name,p_equipment_codes,p_location_text,p_capacity,p_notes)::text; $$;

create or replace function public.cart_scan_catalog_v2()
returns table(cart_id text,cart_number integer,cart_name text,qr_token uuid,is_active boolean,item_count bigint,equipment_codes text[],location_text text,capacity integer,notes text)
language sql stable security invoker set search_path=''
as $$
  select c.id::text,c.number,c.name,c.qr_token,c.is_active,count(ci.equipment_id)::bigint,
    coalesce(array_agg(e.code order by e.code) filter(where e.code is not null),array[]::text[]),c.location_text,c.capacity,c.notes
  from public.equipment_carts c
  left join public.equipment_cart_items ci on ci.cart_id=c.id
  left join public.equipments e on e.id=ci.equipment_id
  where c.is_active group by c.id order by c.number;
$$;

create or replace function public.cart_scan_equipment_list_v2(p_qr_token uuid)
returns table(cart_id text,cart_number integer,cart_name text,cart_location text,cart_capacity integer,cart_notes text,equipment_id uuid,code text,asset_tag text,brand text,model text,label text,school_group text,serial_number text,location_text text,notes text,status public.equipment_status,is_active boolean,qr_token uuid,created_by uuid,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path=''
as $$
  select c.id::text,c.number,c.name,c.location_text,c.capacity,c.notes,
    e.id,e.code,e.asset_tag,e.brand,e.model,e.label,e.school_group,e.serial_number,e.location_text,e.notes,e.status,e.is_active,e.qr_token,e.created_by,e.created_at,e.updated_at
  from public.equipment_carts c
  join public.equipment_cart_items ci on ci.cart_id=c.id
  join public.equipments e on e.id=ci.equipment_id
  where c.qr_token=p_qr_token and c.is_active order by ci.position,e.code;
$$;

create table if not exists public.audit_events(
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid null references auth.users(id) on delete set null,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_events_occurred_idx on public.audit_events(occurred_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_id,occurred_at desc);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type,occurred_at desc);
alter table public.audit_events enable row level security;
drop policy if exists audit_events_select_admin on public.audit_events;
create policy audit_events_select_admin on public.audit_events for select to authenticated using(private."current_role"()='admin'::public.app_role);
revoke all on table public.audit_events from anon;
revoke insert,update,delete on table public.audit_events from authenticated;
grant select on table public.audit_events to authenticated;
grant select,insert,update,delete on table public.audit_events to service_role;
grant usage,select on sequence public.audit_events_id_seq to service_role;

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid:=auth.uid(); v_actor_name text; v_old jsonb; v_new jsonb; v_entity_id text; v_action text:=lower(TG_OP);
begin
  select p.full_name into v_actor_name from public.profiles p where p.id=v_actor;
  if TG_OP='DELETE' then v_old:=to_jsonb(OLD)-'qr_token';v_entity_id:=coalesce(v_old->>'id',v_old->>'equipment_id',v_old->>'cart_id');
  elsif TG_OP='INSERT' then v_new:=to_jsonb(NEW)-'qr_token';v_entity_id:=coalesce(v_new->>'id',v_new->>'equipment_id',v_new->>'cart_id');
  else v_old:=to_jsonb(OLD)-'qr_token';v_new:=to_jsonb(NEW)-'qr_token';v_entity_id:=coalesce(v_new->>'id',v_new->>'equipment_id',v_new->>'cart_id'); end if;
  insert into public.audit_events(actor_id,actor_name,action,entity_type,entity_id,summary,details)
  values(v_actor,v_actor_name,v_action,TG_TABLE_NAME,v_entity_id,TG_TABLE_NAME||' · '||v_action,jsonb_strip_nulls(jsonb_build_object('before',v_old,'after',v_new)));
  return coalesce(NEW,OLD);
end;
$$;

do $$
declare t text; trg text;
begin
  foreach t in array array['equipments','withdrawals','withdrawal_items','reservations','maintenance_events','equipment_carts','equipment_cart_items','profiles','legal_acceptances']
  loop
    trg:='audit_'||t||'_changes';
    execute format('drop trigger if exists %I on public.%I',trg,t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change()',trg,t);
  end loop;
end $$;

grant usage on schema private to authenticated;
grant execute on function private.checkout_equipment_internal_v2(uuid,text,text,text,uuid) to authenticated;
grant execute on function private.checkout_batch_internal_v2(uuid[],text,text,uuid) to authenticated;
grant execute on function private.return_equipment_internal_v2(uuid,uuid) to authenticated;
grant execute on function private.checkout_reservation_internal(bigint,uuid) to authenticated;
grant execute on function private.save_equipment_cart_v2_internal(bigint,integer,text,text[],text,integer,text) to authenticated;

revoke execute on function public.checkout_equipment(uuid,text,text,text,uuid) from public,anon;
revoke execute on function public.checkout_batch(uuid[],text,text,uuid) from public,anon;
revoke execute on function public.return_equipment(uuid,uuid) from public,anon;
revoke execute on function public.checkout_reservation(bigint,uuid) from public,anon;
revoke execute on function public.save_equipment_cart_v2(bigint,integer,text,text[],text,integer,text) from public,anon;
revoke execute on function public.cart_scan_catalog_v2() from public,anon;
revoke execute on function public.cart_scan_equipment_list_v2(uuid) from public,anon;

grant execute on function public.checkout_equipment(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.checkout_batch(uuid[],text,text,uuid) to authenticated;
grant execute on function public.return_equipment(uuid,uuid) to authenticated;
grant execute on function public.checkout_reservation(bigint,uuid) to authenticated;
grant execute on function public.save_equipment_cart_v2(bigint,integer,text,text[],text,integer,text) to authenticated;
grant execute on function public.cart_scan_catalog_v2() to authenticated;
grant execute on function public.cart_scan_equipment_list_v2(uuid) to authenticated;

revoke execute on function public.open_maintenance(uuid,text,text,uuid) from public,anon;
revoke execute on function public.resolve_maintenance(bigint,text) from public,anon;
grant execute on function public.open_maintenance(uuid,text,text,uuid) to authenticated;
grant execute on function public.resolve_maintenance(bigint,text) to authenticated;

notify pgrst,'reload schema';
