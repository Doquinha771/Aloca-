-- Equipa 0.2.0 Alpha: lightweight reservation availability and grouped paginated agenda.
create or replace function public.equipa_preview_quantity(p_school_group text,p_location text,p_occurrences jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_occ jsonb;v_s timestamptz;v_e timestamptz;v_available integer;v_out jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or private.current_role() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED';end if;
 if p_occurrences is null or jsonb_typeof(p_occurrences)<>'array' or jsonb_array_length(p_occurrences) not between 1 and 12 then raise exception 'EQUIPA_OCCURRENCES_INVALID';end if;
 for v_occ in select value from jsonb_array_elements(p_occurrences) loop
  begin v_s:=(v_occ->>'start_at')::timestamptz;v_e:=(v_occ->>'end_at')::timestamptz;
  exception when others then raise exception 'EQUIPA_OCCURRENCES_INVALID';end;
  if v_s is null or v_e is null or v_s<now()-interval '5 minutes' or v_e<=v_s or v_e>v_s+interval '8 hours' or v_s>now()+interval '90 days' then raise exception 'EQUIPA_OCCURRENCES_INVALID';end if;
  select count(*) into v_available from public.equipments e
  where e.is_active and e.status='available'::public.equipment_status
   and (nullif(btrim(coalesce(p_school_group,'')),'') is null or e.school_group=p_school_group)
   and (nullif(btrim(coalesce(p_location,'')),'') is null or lower(coalesce(e.location_text,''))=lower(btrim(p_location)))
   and not exists(select 1 from public.withdrawal_items wi where wi.equipment_id=e.id and wi.returned_at is null)
   and not exists(select 1 from public.maintenance_events m where m.equipment_id=e.id and m.status='open'::public.maintenance_event_status)
   and not exists(select 1 from public.reservations r where r.equipment_id=e.id and r.status='confirmed'::public.reservation_status and r.start_at<v_e and r.end_at>v_s);
  v_out:=v_out||jsonb_build_array(jsonb_build_object('start_at',v_s,'end_at',v_e,'available',v_available));
 end loop;
 return v_out;
end;$$;
revoke all on function public.equipa_preview_quantity(text,text,jsonb) from public,anon;
grant execute on function public.equipa_preview_quantity(text,text,jsonb) to authenticated;

create or replace function public.equipa_booking_summary(p_page integer default 0)
returns table(id bigint,batch_id uuid,series_id uuid,start_at timestamptz,end_at timestamptz,class_name text,destination text,status public.reservation_status,checked_in_at timestamptz,quantity bigint,user_id uuid,representative_code text,total_rows bigint)
language sql stable security invoker set search_path='' as $$
 with visible as (
  select r.id,r.batch_id,r.series_id,r.start_at,r.end_at,r.class_name,r.destination,r.status,r.checked_in_at,r.user_id,e.code
  from public.reservations r left join public.equipments e on e.id=r.equipment_id
 ), grouped as (
  select min(id) id,batch_id,series_id,start_at,end_at,class_name,destination,status,
    min(checked_in_at) checked_in_at,count(*) quantity,user_id,min(code) representative_code
  from visible group by coalesce(batch_id::text,id::text),batch_id,series_id,start_at,end_at,class_name,destination,status,user_id
 ) select g.*,count(*) over() total_rows from grouped g order by g.start_at desc,g.id desc
 limit 30 offset greatest(0,least(coalesce(p_page,0),10000))*30;
$$;
revoke all on function public.equipa_booking_summary(integer) from public,anon;
grant execute on function public.equipa_booking_summary(integer) to authenticated;
notify pgrst,'reload schema';
