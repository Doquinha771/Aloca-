-- Historical bookings must remain queryable even after a device is archived.
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
