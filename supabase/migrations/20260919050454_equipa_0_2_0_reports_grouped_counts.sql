-- Corrige indicadores de reservas: uma ocorrência corresponde a uma reserva agrupada.
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
notify pgrst,'reload schema';
