-- Equipa 0.0.14: exclusão real de cadastros sem vínculos e retirada com prazo.
-- Deliberadamente não elimina histórico escolar nem desativa RLS.

alter table public.withdrawals add column if not exists due_at timestamptz;
create index if not exists withdrawals_due_open_idx
  on public.withdrawals (due_at)
  where status='open'::public.withdrawal_status and due_at is not null;

create or replace function private.remove_equipment_internal(p_equipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_code text;
  v_status public.equipment_status;
  v_active boolean;
  v_historical boolean;
begin
  if auth.uid() is null or private."current_role"() is distinct from 'admin'::public.app_role then
    raise exception 'EQUIPA_ADMIN_REQUIRED';
  end if;
  select e.code,e.status,e.is_active into v_code,v_status,v_active
    from public.equipments e where e.id=p_equipment_id for update;
  if not found then raise exception 'EQUIPA_EQUIPMENT_NOT_FOUND'; end if;

  if v_status='in_use'::public.equipment_status or exists (
      select 1 from public.withdrawal_items wi
      where wi.equipment_id=p_equipment_id and wi.returned_at is null
    ) then
    raise exception 'EQUIPA_RETURN_BEFORE_DELETE';
  end if;
  if exists (select 1 from public.reservations r
             where r.equipment_id=p_equipment_id
               and r.status='confirmed'::public.reservation_status
               and r.end_at>now()) then
    raise exception 'EQUIPA_CANCEL_RESERVATIONS_FIRST';
  end if;
  if exists (select 1 from public.maintenance_events m
             where m.equipment_id=p_equipment_id and m.status='open'::public.maintenance_event_status) then
    raise exception 'EQUIPA_CLOSE_MAINTENANCE_FIRST';
  end if;

  select (exists(select 1 from public.withdrawal_items wi where wi.equipment_id=p_equipment_id)
       or exists(select 1 from public.reservations r where r.equipment_id=p_equipment_id)
       or exists(select 1 from public.maintenance_events m where m.equipment_id=p_equipment_id))
       into v_historical;

  if v_historical then
    update public.equipments
       set is_active=false,status='unavailable'::public.equipment_status
     where id=p_equipment_id;
    -- Não apagar retiradas, reservas, manutenções nem seus vínculos.
    return jsonb_build_object('mode','archived','code',v_code);
  end if;

  -- A exclusão do equipamento novo também remove somente seu vínculo com carrinhos
  -- por FK ON DELETE CASCADE. A trilha de auditoria registra a exclusão.
  delete from public.equipments e where e.id=p_equipment_id;
  return jsonb_build_object('mode','deleted','code',v_code);
end;
$$;
revoke all on function private.remove_equipment_internal(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.remove_equipment_internal(uuid) to authenticated;

create or replace function public.remove_equipment(p_equipment_id uuid)
returns jsonb
language sql
security invoker
set search_path=''
as $$ select private.remove_equipment_internal(p_equipment_id); $$;
revoke all on function public.remove_equipment(uuid) from public,anon;
grant execute on function public.remove_equipment(uuid) to authenticated;

create or replace function private.checkout_with_due_internal(
  p_equipment_ids uuid[], p_class_name text, p_destination text,
  p_student_name text, p_due_at timestamptz, p_client_action_id uuid
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id bigint;
  v_count integer;
begin
  if auth.uid() is null or private."current_role"() is null then
    raise exception 'EQUIPA_ACCOUNT_DISABLED';
  end if;
  if p_due_at is null or p_due_at <= now() + interval '5 minutes'
     or p_due_at > now() + interval '30 days' then
    raise exception 'EQUIPA_DUE_DATE_INVALID';
  end if;
  v_count := coalesce(array_length(p_equipment_ids,1),0);
  if v_count<1 or v_count>60 or exists(select 1 from unnest(p_equipment_ids) x where x is null) then
    raise exception 'EQUIPA_BATCH_SIZE_INVALID';
  end if;
  -- Mesmo bloqueio de linhas usado no checkout original, para impedir
  -- conflitos com reservas criadas durante uma retirada.
  perform e.id from public.equipments e
   where e.id=any(p_equipment_ids)
   order by e.id for update;
  if exists(
    select 1 from public.reservations r
    where r.equipment_id=any(p_equipment_ids)
      and r.status='confirmed'::public.reservation_status
      and r.start_at<p_due_at and r.end_at>now()
  ) then
    raise exception 'EQUIPA_RESERVATION_CONFLICT';
  end if;

  if v_count=1 then
    v_id:=private.checkout_equipment_internal_v2(
      p_equipment_ids[1],p_class_name,p_destination,p_student_name,p_client_action_id
    );
  else
    v_id:=private.checkout_batch_internal_v2(
      p_equipment_ids,p_class_name,p_destination,p_client_action_id
    );
  end if;

  -- Idempotência: ao repetir um client_action_id, não mudar o prazo original.
  update public.withdrawals w set due_at=p_due_at
   where w.id=v_id and w.due_at is null;
  return v_id::text;
end;
$$;
revoke all on function private.checkout_with_due_internal(uuid[],text,text,text,timestamptz,uuid) from public,anon;
grant execute on function private.checkout_with_due_internal(uuid[],text,text,text,timestamptz,uuid) to authenticated;
create or replace function public.checkout_with_due(
  p_equipment_ids uuid[], p_class_name text, p_destination text,
  p_student_name text, p_due_at timestamptz, p_client_action_id uuid
) returns text language sql security invoker set search_path=''
as $$ select private.checkout_with_due_internal(p_equipment_ids,p_class_name,p_destination,p_student_name,p_due_at,p_client_action_id); $$;
revoke all on function public.checkout_with_due(uuid[],text,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.checkout_with_due(uuid[],text,text,text,timestamptz,uuid) to authenticated;

create or replace function public.overdue_withdrawals_count()
returns bigint
language sql
stable
security invoker
set search_path=''
as $$
  select count(*)::bigint from public.withdrawals w
  where w.status='open'::public.withdrawal_status
    and w.due_at < now();
$$;
revoke all on function public.overdue_withdrawals_count() from public,anon;
grant execute on function public.overdue_withdrawals_count() to authenticated;
notify pgrst,'reload schema';
