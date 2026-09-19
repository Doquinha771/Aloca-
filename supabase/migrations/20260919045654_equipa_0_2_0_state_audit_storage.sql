-- Equipa Alpha: integrity guard, compact audit events and short-lived idempotency receipts.
create or replace function private.equipa_guard_equipment_state() returns trigger language plpgsql security definer set search_path='' as $$
declare v_open boolean;
begin
 if new.status is not distinct from old.status and new.is_active is not distinct from old.is_active then return new;end if;
 select exists(select 1 from public.withdrawal_items wi where wi.equipment_id=new.id and wi.returned_at is null) into v_open;
 if v_open and (new.status<>'in_use'::public.equipment_status or not new.is_active) then raise exception 'EQUIPA_ACTIVE_LOAN_STATE_CONFLICT';end if;
 if not v_open and new.status='in_use'::public.equipment_status then raise exception 'EQUIPA_CHECKOUT_REQUIRED';end if;
 if new.status='available'::public.equipment_status and exists(select 1 from public.maintenance_events m where m.equipment_id=new.id and m.status='open'::public.maintenance_event_status) then raise exception 'EQUIPA_MAINTENANCE_STILL_OPEN';end if;
 return new;
end;$$;
drop trigger if exists equipa_equipment_state_guard on public.equipments;
create trigger equipa_equipment_state_guard before update of status,is_active on public.equipments for each row execute function private.equipa_guard_equipment_state();

create or replace function private.audit_row_change() returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_name text;v_old jsonb;v_new jsonb;v_keys text[];v_id text;v_fields jsonb;
begin
 select full_name into v_name from public.profiles where id=v_actor;
 case TG_TABLE_NAME
  when 'equipments' then v_keys:=array['id','code','status','is_active','school_group','location_text'];
  when 'reservations' then v_keys:=array['id','equipment_id','batch_id','status','start_at','end_at','checked_in_at','withdrawal_id'];
  when 'withdrawals' then v_keys:=array['id','status','requested_by','class_name','destination','due_at','withdrawn_at','returned_at'];
  when 'withdrawal_items' then v_keys:=array['id','withdrawal_id','equipment_id','returned_at','return_condition'];
  when 'maintenance_events' then v_keys:=array['id','equipment_id','status','opened_at','closed_at'];
  when 'profiles' then v_keys:=array['id','role','is_active','disabled_at'];
  when 'legal_acceptances' then v_keys:=array['id','user_id','terms_version','privacy_version','accepted_at'];
  when 'equipment_carts' then v_keys:=array['id','number','is_active','location_text','capacity'];
  when 'equipment_cart_items' then v_keys:=array['cart_id','equipment_id','position'];
  else v_keys:=array['id'];end case;
 if TG_OP<>'INSERT' then
  select coalesce(jsonb_object_agg(k,to_jsonb(old)->k),'{}'::jsonb) into v_old from unnest(v_keys) k where to_jsonb(old)?k;
 end if;
 if TG_OP<>'DELETE' then
  select coalesce(jsonb_object_agg(k,to_jsonb(new)->k),'{}'::jsonb) into v_new from unnest(v_keys) k where to_jsonb(new)?k;
 end if;
 v_id:=coalesce(v_new->>'id',v_old->>'id',v_new->>'equipment_id',v_old->>'equipment_id',v_new->>'cart_id',v_old->>'cart_id');
 if TG_OP='UPDATE' and v_old=v_new then return new;end if;
 v_fields:=jsonb_strip_nulls(jsonb_build_object('before',v_old,'after',v_new));
 insert into public.audit_events(actor_id,actor_name,action,entity_type,entity_id,summary,details)
 values(v_actor,v_name,lower(TG_OP),TG_TABLE_NAME,v_id,TG_TABLE_NAME||' · '||lower(TG_OP),v_fields);
 return coalesce(new,old);
end;$$;

create or replace function private.equipa_cleanup_receipts_internal() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null or private.current_role()<>'admin'::public.app_role then raise exception 'EQUIPA_ADMIN_REQUIRED';end if;
 delete from public.equipa_operation_receipts where created_at<now()-interval '14 days';
 get diagnostics n=row_count;return n;
end;$$;
create or replace function public.equipa_cleanup_receipts() returns integer language sql security invoker set search_path='' as $$
 select private.equipa_cleanup_receipts_internal();
$$;
revoke all on function private.equipa_cleanup_receipts_internal() from public,anon;
revoke all on function public.equipa_cleanup_receipts() from public,anon;
grant execute on function private.equipa_cleanup_receipts_internal() to authenticated;
grant execute on function public.equipa_cleanup_receipts() to authenticated;
notify pgrst,'reload schema';
