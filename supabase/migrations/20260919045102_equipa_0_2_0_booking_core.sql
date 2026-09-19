-- Equipa 0.2.0 Alpha. Schema and transactional quantity bookings.
-- Run only AFTER the existing Aloca/Dasein/Equipa baseline migrations.
alter table public.reservations add column if not exists batch_id uuid;
alter table public.reservations add column if not exists series_id uuid;
alter table public.reservations add column if not exists occurrence_index smallint;
alter table public.reservations add column if not exists checked_in_at timestamptz;
alter table public.reservations add column if not exists expired_at timestamptz;
create index if not exists reservations_batch_occurrence_idx on public.reservations(batch_id,start_at) where batch_id is not null;
create index if not exists reservations_series_start_idx on public.reservations(series_id,start_at) where series_id is not null;
alter table public.withdrawal_items add column if not exists return_condition text;
alter table public.withdrawal_items add constraint withdrawal_items_return_condition_check check (return_condition is null or return_condition in ('returned','damaged','missing'));
create index if not exists withdrawals_active_due_idx on public.withdrawals(due_at) where status='open'::public.withdrawal_status and due_at is not null;

create or replace function private.expire_unclaimed_reservations_internal() returns integer language plpgsql security definer set search_path='' as $$
declare v_n integer;
begin
 update public.reservations set status='expired'::public.reservation_status,expired_at=now()
 where status='confirmed'::public.reservation_status and checked_in_at is null and start_at+interval '15 minutes'<now();
 get diagnostics v_n=row_count;return v_n;
end; $$;
create or replace function public.equipa_expire_reservations() returns integer language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
 return private.expire_unclaimed_reservations_internal();
end; $$;
revoke all on function public.equipa_expire_reservations() from public,anon;
grant execute on function public.equipa_expire_reservations() to authenticated;

create or replace function private.reserve_quantity_internal(
 p_quantity integer,p_school_group text,p_location text,p_class_name text,p_destination text,
 p_occurrences jsonb,p_notes text,p_client_action_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_occ jsonb;v_start timestamptz;v_end timestamptz;
 v_selected uuid[];v_plan jsonb:='[]'::jsonb;v_count integer;v_index integer:=0;
 v_batch uuid:=p_client_action_id;v_e uuid;v_existing integer;
begin
 if v_user is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
 if p_client_action_id is null then raise exception 'EQUIPA_ACTION_ID_REQUIRED'; end if;
 if p_quantity is null or p_quantity<1 or p_quantity>60 then raise exception 'EQUIPA_QUANTITY_INVALID'; end if;
 if p_occurrences is null or jsonb_typeof(p_occurrences)<>'array' or jsonb_array_length(p_occurrences) not between 1 and 12 then raise exception 'EQUIPA_OCCURRENCES_INVALID'; end if;
 if length(btrim(coalesce(p_class_name,''))) not between 1 and 120 or length(btrim(coalesce(p_destination,''))) not between 1 and 160 or length(coalesce(p_notes,''))>800 or length(coalesce(p_location,''))>160 then raise exception 'EQUIPA_RESERVATION_FIELDS_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtext(v_user::text),hashtext(p_client_action_id::text));
 select count(*) into v_existing from public.reservations where batch_id=v_batch and user_id=v_user;
 if v_existing>0 then return jsonb_build_object('ok',true,'batch_id',v_batch,'quantity',p_quantity,'occurrences',v_existing/p_quantity,'replayed',true); end if;
 if exists(select 1 from public.reservations where batch_id=v_batch) then raise exception 'EQUIPA_ACTION_ID_CONFLICT'; end if;
 perform private.expire_unclaimed_reservations_internal();
 for v_occ in select value from jsonb_array_elements(p_occurrences) loop
  v_index:=v_index+1;
  begin v_start:=(v_occ->>'start_at')::timestamptz;v_end:=(v_occ->>'end_at')::timestamptz;
  exception when others then raise exception 'EQUIPA_OCCURRENCES_INVALID';end;
  if v_start is null or v_end is null or v_start<now()-interval '5 minutes' or v_start>now()+interval '90 days' or v_end<=v_start or v_end>v_start+interval '8 hours' then raise exception 'EQUIPA_OCCURRENCES_INVALID'; end if;
  select array_agg(s.id) into v_selected from (
   select e.id from public.equipments e
   where e.is_active and e.status='available'::public.equipment_status
    and (nullif(btrim(coalesce(p_school_group,'')),'') is null or e.school_group=p_school_group)
    and (nullif(btrim(coalesce(p_location,'')),'') is null or lower(coalesce(e.location_text,''))=lower(btrim(p_location)))
    and not exists(select 1 from public.withdrawal_items wi where wi.equipment_id=e.id and wi.returned_at is null)
    and not exists(select 1 from public.maintenance_events m where m.equipment_id=e.id and m.status='open'::public.maintenance_event_status)
    and not exists(select 1 from public.reservations r where r.equipment_id=e.id and r.status='confirmed'::public.reservation_status and r.start_at<v_end and r.end_at>v_start)
   order by e.id limit p_quantity for update of e skip locked
  ) s;
  v_count:=coalesce(array_length(v_selected,1),0);
  if v_count<p_quantity then return jsonb_build_object('ok',false,'code','EQUIPA_INSUFFICIENT_STOCK','occurrence',v_index,'requested',p_quantity,'available',v_count,'start_at',v_start); end if;
  v_plan:=v_plan||jsonb_build_array(jsonb_build_object('start_at',v_start,'end_at',v_end,'ids',to_jsonb(v_selected),'index',v_index));
 end loop;
 for v_occ in select value from jsonb_array_elements(v_plan) loop
  v_start:=(v_occ->>'start_at')::timestamptz;v_end:=(v_occ->>'end_at')::timestamptz;
  for v_e in select value::uuid from jsonb_array_elements_text(v_occ->'ids') loop
   insert into public.reservations(equipment_id,user_id,class_name,destination,start_at,end_at,notes,status,client_action_id,batch_id,series_id,occurrence_index)
   values(v_e,v_user,btrim(p_class_name),btrim(p_destination),v_start,v_end,nullif(btrim(p_notes),''),'confirmed'::public.reservation_status,gen_random_uuid(),v_batch,case when jsonb_array_length(p_occurrences)>1 then v_batch else null end,(v_occ->>'index')::smallint);
  end loop;
 end loop;
 return jsonb_build_object('ok',true,'batch_id',v_batch,'quantity',p_quantity,'occurrences',jsonb_array_length(v_plan),'replayed',false);
exception when exclusion_violation or unique_violation then raise exception 'EQUIPA_RESERVATION_CONFLICT';
end; $$;
create or replace function public.equipa_reserve_quantity(p_quantity integer,p_school_group text,p_location text,p_class_name text,p_destination text,p_occurrences jsonb,p_notes text,p_client_action_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.reserve_quantity_internal(p_quantity,p_school_group,p_location,p_class_name,p_destination,p_occurrences,p_notes,p_client_action_id);$$;

create or replace function private.booking_action_internal(p_reservation_id bigint,p_action text,p_scope text default 'occurrence') returns jsonb language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;v_count integer;
begin
 if auth.uid() is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
 select * into v_r from public.reservations where id=p_reservation_id for update;
 if not found then raise exception 'EQUIPA_RESERVATION_NOT_FOUND';end if;
 if v_r.user_id<>auth.uid() and private.current_role()<>'admin'::public.app_role then raise exception 'EQUIPA_FORBIDDEN';end if;
 if p_action='checkin' then
  if now()<v_r.start_at-interval '30 minutes' or now()>v_r.start_at+interval '15 minutes' then raise exception 'EQUIPA_CHECKIN_WINDOW';end if;
  if v_r.status<>'confirmed'::public.reservation_status then raise exception 'EQUIPA_RESERVATION_NOT_ACTIVE';end if;
  if v_r.batch_id is not null then
   update public.reservations set checked_in_at=coalesce(checked_in_at,now()) where batch_id=v_r.batch_id and start_at=v_r.start_at and status='confirmed'::public.reservation_status;
  else update public.reservations set checked_in_at=coalesce(checked_in_at,now()) where id=v_r.id;end if;
 elsif p_action='cancel' then
  if p_scope not in ('occurrence','future','series') then raise exception 'EQUIPA_SCOPE_INVALID';end if;
  if v_r.batch_id is null then
   update public.reservations set status='cancelled'::public.reservation_status,cancelled_at=now() where id=v_r.id and status='confirmed'::public.reservation_status and start_at>now();
  else
   update public.reservations set status='cancelled'::public.reservation_status,cancelled_at=now() where batch_id=v_r.batch_id and status='confirmed'::public.reservation_status and start_at>now()
    and ((p_scope='occurrence' and start_at=v_r.start_at) or (p_scope='future' and start_at>=v_r.start_at) or p_scope='series');
  end if;
 else raise exception 'EQUIPA_ACTION_INVALID';end if;
 get diagnostics v_count=row_count;
 return jsonb_build_object('ok',true,'updated',v_count);
end;$$;
create or replace function public.equipa_booking_action(p_reservation_id bigint,p_action text,p_scope text default 'occurrence') returns jsonb language sql security invoker set search_path='' as $$ select private.booking_action_internal(p_reservation_id,p_action,p_scope); $$;

-- The checkout internal is installed in the next timestamped migration.
revoke all on function private.reserve_quantity_internal(integer,text,text,text,text,jsonb,text,uuid) from public,anon;
revoke all on function private.booking_action_internal(bigint,text,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.reserve_quantity_internal(integer,text,text,text,text,jsonb,text,uuid) to authenticated;
grant execute on function private.booking_action_internal(bigint,text,text) to authenticated;
revoke all on function public.equipa_reserve_quantity(integer,text,text,text,text,jsonb,text,uuid) from public,anon;
revoke all on function public.equipa_booking_action(bigint,text,text) from public,anon;
grant execute on function public.equipa_reserve_quantity(integer,text,text,text,text,jsonb,text,uuid) to authenticated;
grant execute on function public.equipa_booking_action(bigint,text,text) to authenticated;
notify pgrst,'reload schema';
