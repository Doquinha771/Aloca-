-- Equipa 0.2.0 Alpha: shared checkout path with legacy API compatibility.
alter table public.reservations drop constraint if exists reservations_withdrawal_id_key;
create index if not exists reservations_withdrawal_id_idx on public.reservations(withdrawal_id) where withdrawal_id is not null;

create or replace function private.reject_reserved_checkout() returns trigger language plpgsql security definer set search_path='' as $$
declare v_due_text text:=nullif(current_setting('equipa.checkout_due',true),'');
begin
 if exists(select 1 from public.reservations r where r.equipment_id=new.equipment_id
  and r.status='confirmed'::public.reservation_status and r.end_at>now()
  and (v_due_text is null or r.start_at<v_due_text::timestamptz))
 then raise exception 'EQUIPA_RESERVATION_CONFLICT';end if;
 return new;
end;$$;
drop trigger if exists equipa_reject_reserved_checkout on public.withdrawal_items;
create trigger equipa_reject_reserved_checkout before insert on public.withdrawal_items for each row execute function private.reject_reserved_checkout();

create or replace function private.checkout_booking_internal(p_reservation_id bigint,p_client_action_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_r public.reservations%rowtype;v_ids uuid[];v_id bigint;v_count integer;
begin
 if auth.uid() is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED';end if;
 if p_client_action_id is null then raise exception 'EQUIPA_ACTION_ID_REQUIRED';end if;
 select * into v_r from public.reservations where id=p_reservation_id for update;
 if not found then raise exception 'EQUIPA_RESERVATION_NOT_FOUND';end if;
 if v_r.user_id<>auth.uid() and private.current_role()<>'admin'::public.app_role then raise exception 'EQUIPA_FORBIDDEN';end if;
 if v_r.status='fulfilled'::public.reservation_status and v_r.withdrawal_id is not null then return v_r.withdrawal_id::text;end if;
 if v_r.status<>'confirmed'::public.reservation_status then raise exception 'EQUIPA_RESERVATION_NOT_ACTIVE';end if;
 if now()<v_r.start_at-interval '30 minutes' or now()>=v_r.end_at then raise exception 'EQUIPA_CHECKIN_WINDOW';end if;
 if v_r.checked_in_at is null and now()>v_r.start_at+interval '15 minutes' then raise exception 'EQUIPA_CHECKIN_EXPIRED';end if;
 perform 1 from public.reservations r where
  (v_r.batch_id is not null and r.batch_id=v_r.batch_id and r.start_at=v_r.start_at)
  or (v_r.batch_id is null and r.id=v_r.id)
 order by r.equipment_id for update;
 select array_agg(r.equipment_id order by r.equipment_id),count(*) into v_ids,v_count
 from public.reservations r where
 ((v_r.batch_id is not null and r.batch_id=v_r.batch_id and r.start_at=v_r.start_at)
  or (v_r.batch_id is null and r.id=v_r.id))
 and r.status='confirmed'::public.reservation_status and r.user_id=v_r.user_id;
 if v_count is null or v_count=0 or v_count>60 then raise exception 'EQUIPA_BOOKING_STATE_INVALID';end if;
 perform 1 from public.equipments e where e.id=any(v_ids) order by e.id for update;
 if (select count(*) from public.equipments e where e.id=any(v_ids)
   and e.is_active and e.status='available'::public.equipment_status)<>v_count
 then raise exception 'EQUIPA_AVAILABILITY_CHANGED';end if;
 perform set_config('equipa.checkout_due',v_r.end_at::text,true);
 update public.reservations r set status='fulfilled'::public.reservation_status,fulfilled_at=now()
 where ((v_r.batch_id is not null and r.batch_id=v_r.batch_id and r.start_at=v_r.start_at)
  or (v_r.batch_id is null and r.id=v_r.id)) and r.status='confirmed'::public.reservation_status;
 if v_count=1 then
  v_id:=private.checkout_equipment_internal_v2(v_ids[1],v_r.class_name,v_r.destination,null,p_client_action_id);
 else
  v_id:=private.checkout_batch_internal_v2(v_ids,v_r.class_name,v_r.destination,p_client_action_id);
 end if;
 update public.withdrawals w set due_at=v_r.end_at where w.id=v_id and w.due_at is null;
 update public.reservations r set withdrawal_id=v_id where
 ((v_r.batch_id is not null and r.batch_id=v_r.batch_id and r.start_at=v_r.start_at)
  or (v_r.batch_id is null and r.id=v_r.id));
 return v_id::text;
end;$$;
create or replace function private.checkout_reservation_internal(p_reservation_id bigint,p_client_action_id uuid)
returns bigint language sql security definer set search_path='' as $$
 select private.checkout_booking_internal(p_reservation_id,p_client_action_id)::bigint;
$$;
create or replace function public.equipa_checkout_booking(p_reservation_id bigint,p_client_action_id uuid)
returns text language sql security invoker set search_path='' as $$
 select private.checkout_booking_internal(p_reservation_id,p_client_action_id);
$$;

create or replace function private.checkout_with_due_internal(
 p_equipment_ids uuid[],p_class_name text,p_destination text,p_student_name text,
 p_due_at timestamptz,p_client_action_id uuid
) returns text language plpgsql security definer set search_path='' as $$
declare v_id bigint;v_count integer;
begin
 if auth.uid() is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED';end if;
 if p_due_at is null or p_due_at<=now()+interval '5 minutes' or p_due_at>now()+interval '30 days'
  then raise exception 'EQUIPA_DUE_DATE_INVALID';end if;
 v_count:=coalesce(array_length(p_equipment_ids,1),0);
 if v_count<1 or v_count>60 or exists(select 1 from unnest(p_equipment_ids) x where x is null)
  then raise exception 'EQUIPA_BATCH_SIZE_INVALID';end if;
 perform 1 from public.equipments e where e.id=any(p_equipment_ids) order by e.id for update;
 perform set_config('equipa.checkout_due',p_due_at::text,true);
 if exists(select 1 from public.reservations r where r.equipment_id=any(p_equipment_ids)
   and r.status='confirmed'::public.reservation_status and r.start_at<p_due_at and r.end_at>now())
  then raise exception 'EQUIPA_RESERVATION_CONFLICT';end if;
 if v_count=1 then
  v_id:=private.checkout_equipment_internal_v2(p_equipment_ids[1],p_class_name,p_destination,p_student_name,p_client_action_id);
 else
  v_id:=private.checkout_batch_internal_v2(p_equipment_ids,p_class_name,p_destination,p_client_action_id);
 end if;
 update public.withdrawals w set due_at=p_due_at where w.id=v_id and w.due_at is null;
 return v_id::text;
end;$$;
revoke all on function private.checkout_booking_internal(bigint,uuid) from public,anon;
grant execute on function private.checkout_booking_internal(bigint,uuid) to authenticated;
revoke all on function public.equipa_checkout_booking(bigint,uuid) from public,anon;
grant execute on function public.equipa_checkout_booking(bigint,uuid) to authenticated;
notify pgrst,'reload schema';
