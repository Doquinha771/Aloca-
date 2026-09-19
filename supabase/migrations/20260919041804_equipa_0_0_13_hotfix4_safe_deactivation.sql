-- Equipa 0.0.13 Hotfix 4. Já aplicada no projeto Supabase em produção.
create or replace function public.deactivate_equipment(p_equipment_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_status public.equipment_status; v_active boolean;
begin
  if auth.uid() is null or private."current_role"() is distinct from 'admin'::public.app_role then
    raise exception 'EQUIPA_ADMIN_REQUIRED';
  end if;
  select e.status,e.is_active into v_status,v_active
  from public.equipments e where e.id=p_equipment_id for update;
  if not found then raise exception 'EQUIPA_EQUIPMENT_NOT_FOUND'; end if;
  if not v_active then return p_equipment_id; end if;
  if v_status='in_use'::public.equipment_status or exists (
    select 1 from public.withdrawal_items wi
    where wi.equipment_id=p_equipment_id and wi.returned_at is null
  ) then raise exception 'EQUIPA_RETURN_BEFORE_DEACTIVATE'; end if;
  if exists (
    select 1 from public.reservations r
    where r.equipment_id=p_equipment_id
    and r.status='confirmed'::public.reservation_status
    and r.end_at>now()
  ) then raise exception 'EQUIPA_CANCEL_RESERVATIONS_FIRST'; end if;
  update public.equipments set is_active=false,status='unavailable'::public.equipment_status
  where id=p_equipment_id;
  return p_equipment_id;
end;
$$;
revoke all on function public.deactivate_equipment(uuid) from public,anon;
grant execute on function public.deactivate_equipment(uuid) to authenticated;
revoke delete on table public.equipments from authenticated;
drop policy if exists equipments_delete_admin on public.equipments;
notify pgrst, 'reload schema';
