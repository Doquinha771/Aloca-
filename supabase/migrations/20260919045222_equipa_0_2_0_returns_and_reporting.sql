-- Equipa 0.2.0 Alpha: conferência em lote, idempotência e relatórios por período.
create table if not exists public.equipa_operation_receipts(
 id uuid primary key,
 actor_id uuid not null references auth.users(id) on delete cascade,
 withdrawal_id bigint not null references public.withdrawals(id) on delete restrict,
 result jsonb not null,created_at timestamptz not null default now()
);
create index if not exists equipa_operation_receipts_created_idx on public.equipa_operation_receipts(created_at);
alter table public.equipa_operation_receipts enable row level security;
revoke all on public.equipa_operation_receipts from anon,authenticated;

create or replace function private.return_items_internal(p_withdrawal_id bigint,p_items jsonb,p_client_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_w public.withdrawals%rowtype;v_x jsonb;v_e uuid;
 v_condition text;v_item_id bigint;v_returned timestamptz;v_pending integer;
 v_existing jsonb;v_changed integer:=0;v_seen uuid[]:=array[]::uuid[];v_now timestamptz:=now();
begin
 if v_user is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED';end if;
 if p_client_action_id is null then raise exception 'EQUIPA_ACTION_ID_REQUIRED';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 60 then raise exception 'EQUIPA_RETURN_ITEMS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtext(v_user::text),hashtext(p_client_action_id::text));
 select result into v_existing from public.equipa_operation_receipts where id=p_client_action_id and actor_id=v_user;
 if found then return v_existing;end if;
 select * into v_w from public.withdrawals where id=p_withdrawal_id for update;
 if not found then raise exception 'EQUIPA_WITHDRAWAL_NOT_FOUND';end if;
 if v_w.requested_by<>v_user and private.current_role() not in ('teacher'::public.app_role,'admin'::public.app_role) then raise exception 'EQUIPA_FORBIDDEN';end if;
 if v_w.status<>'open'::public.withdrawal_status then raise exception 'EQUIPA_WITHDRAWAL_NOT_ACTIVE';end if;
 perform 1 from public.equipments e where e.id in (select (x->>'equipment_id')::uuid from jsonb_array_elements(p_items) x) order by e.id for update;
 perform 1 from public.withdrawal_items wi where wi.withdrawal_id=p_withdrawal_id
  and wi.equipment_id in (select (x->>'equipment_id')::uuid from jsonb_array_elements(p_items) x)
  order by wi.equipment_id for update;
 for v_x in select value from jsonb_array_elements(p_items) loop
  begin v_e:=(v_x->>'equipment_id')::uuid;
  exception when others then raise exception 'EQUIPA_RETURN_ITEMS_INVALID';end;
  v_condition:=v_x->>'condition';
  if v_e is null or v_e=any(v_seen) or v_condition not in ('returned','damaged','missing','pending') then raise exception 'EQUIPA_RETURN_ITEMS_INVALID';end if;
  v_seen:=array_append(v_seen,v_e);
  select wi.id,wi.returned_at into v_item_id,v_returned from public.withdrawal_items wi
  where wi.withdrawal_id=p_withdrawal_id and wi.equipment_id=v_e for update;
  if not found then raise exception 'EQUIPA_ITEM_NOT_IN_WITHDRAWAL';end if;
  if v_returned is not null then
   if v_condition in ('pending','missing') then raise exception 'EQUIPA_ITEM_ALREADY_RETURNED';end if;
   continue;
  end if;
  if v_condition='pending' then continue;end if;
  if v_condition='missing' then
   update public.withdrawal_items set return_condition='missing' where id=v_item_id;
   v_changed:=v_changed+1;continue;
  end if;
  update public.withdrawal_items set returned_at=v_now,return_action_id=gen_random_uuid(),return_condition=v_condition where id=v_item_id;
  if v_condition='damaged' then
   update public.equipments set status='maintenance'::public.equipment_status where id=v_e;
   update public.reservations set status='cancelled'::public.reservation_status,cancelled_at=v_now
    where equipment_id=v_e and status='confirmed'::public.reservation_status and end_at>v_now;
   insert into public.maintenance_events(equipment_id,opened_by,title,notes,client_action_id)
    values(v_e,v_user,'Avaria identificada na devolução','Equipamento encaminhado para conferência técnica.',gen_random_uuid())
    on conflict do nothing;
  else
   update public.equipments set status='available'::public.equipment_status where id=v_e and is_active;
  end if;
  v_changed:=v_changed+1;
 end loop;
 select count(*) into v_pending from public.withdrawal_items where withdrawal_id=p_withdrawal_id and returned_at is null;
 if v_pending=0 then
  update public.withdrawals set status='returned'::public.withdrawal_status,returned_at=v_now where id=p_withdrawal_id;
 end if;
 v_existing:=jsonb_build_object('ok',true,'withdrawal_id',p_withdrawal_id,'changed',v_changed,'pending',v_pending,'complete',v_pending=0);
 insert into public.equipa_operation_receipts(id,actor_id,withdrawal_id,result) values(p_client_action_id,v_user,p_withdrawal_id,v_existing);
 return v_existing;
end;$$;
create or replace function public.equipa_return_items(p_withdrawal_id bigint,p_items jsonb,p_client_action_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.return_items_internal(p_withdrawal_id,p_items,p_client_action_id);$$;
revoke all on function private.return_items_internal(bigint,jsonb,uuid) from public,anon;
grant execute on function private.return_items_internal(bigint,jsonb,uuid) to authenticated;
revoke all on function public.equipa_return_items(bigint,jsonb,uuid) from public,anon;
grant execute on function public.equipa_return_items(bigint,jsonb,uuid) to authenticated;

create or replace function private.reports_internal(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb;
begin
 if auth.uid() is null or private.current_role()<>'admin'::public.app_role then raise exception 'EQUIPA_ADMIN_REQUIRED';end if;
 if p_from is null or p_to is null or p_from>=p_to or p_to>now()+interval '1 day' or p_to-p_from>interval '370 days' then raise exception 'EQUIPA_REPORT_RANGE_INVALID';end if;
 select jsonb_build_object(
  'reservations',(select count(distinct coalesce(r.batch_id::text||':'||r.start_at::text,r.id::text)) from public.reservations r where r.created_at>=p_from and r.created_at<p_to),
  'cancelled',(select count(distinct coalesce(r.batch_id::text||':'||r.start_at::text,r.id::text)) from public.reservations r where r.status='cancelled'::public.reservation_status and r.cancelled_at>=p_from and r.cancelled_at<p_to),
  'expired',(select count(distinct coalesce(r.batch_id::text||':'||r.start_at::text,r.id::text)) from public.reservations r where r.status='expired'::public.reservation_status and r.expired_at>=p_from and r.expired_at<p_to),
  'withdrawals',(select count(*) from public.withdrawals w where w.withdrawn_at>=p_from and w.withdrawn_at<p_to),
  'used_equipment',(select count(distinct wi.equipment_id) from public.withdrawal_items wi join public.withdrawals w on w.id=wi.withdrawal_id where w.withdrawn_at>=p_from and w.withdrawn_at<p_to),
  'returned',(select count(*) from public.withdrawal_items wi where wi.returned_at>=p_from and wi.returned_at<p_to),
  'damaged',(select count(*) from public.withdrawal_items wi where wi.returned_at>=p_from and wi.returned_at<p_to and wi.return_condition='damaged'),
  'late_open',(select count(*) from public.withdrawals w where w.status='open'::public.withdrawal_status and w.due_at<now()),
  'maintenance_open',(select count(*) from public.maintenance_events m where m.status='open'::public.maintenance_event_status),
  'avg_minutes',(select round(avg(extract(epoch from wi.returned_at-w.withdrawn_at)/60))::integer from public.withdrawal_items wi join public.withdrawals w on w.id=wi.withdrawal_id where wi.returned_at>=p_from and wi.returned_at<p_to),
  'top_equipment',(select coalesce(jsonb_agg(t.item order by t.use_count desc),'[]'::jsonb) from (
   select jsonb_build_object('code',e.code,'uses',count(*)) item,count(*) use_count
   from public.withdrawal_items wi join public.withdrawals w on w.id=wi.withdrawal_id
   join public.equipments e on e.id=wi.equipment_id
   where w.withdrawn_at>=p_from and w.withdrawn_at<p_to group by e.id order by count(*) desc limit 8
  ) t)
 ) into v_data;
 return v_data;
end;$$;
create or replace function public.equipa_admin_reports(p_from timestamptz,p_to timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$select private.reports_internal(p_from,p_to);$$;
revoke all on function private.reports_internal(timestamptz,timestamptz) from public,anon;
grant execute on function private.reports_internal(timestamptz,timestamptz) to authenticated;
revoke all on function public.equipa_admin_reports(timestamptz,timestamptz) from public,anon;
grant execute on function public.equipa_admin_reports(timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
