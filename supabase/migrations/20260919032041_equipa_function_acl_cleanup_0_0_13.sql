revoke execute on function public.admin_capacity_status() from public, anon;
revoke execute on function public.cancel_reservation(bigint) from public, anon;
revoke execute on function public.create_reservation(uuid,text,text,timestamptz,timestamptz,text,uuid) from public, anon;
grant execute on function public.admin_capacity_status() to authenticated;
grant execute on function public.cancel_reservation(bigint) to authenticated;
grant execute on function public.create_reservation(uuid,text,text,timestamptz,timestamptz,text,uuid) to authenticated;

drop policy if exists classes_select_authenticated on public.classes;
create policy classes_select_authenticated on public.classes for select to authenticated
using(private."current_role"() is not null and (is_active=true or private."current_role"()='admin'::public.app_role));

drop policy if exists locations_select_authenticated on public.locations;
create policy locations_select_authenticated on public.locations for select to authenticated
using(private."current_role"() is not null and (is_active=true or private."current_role"()='admin'::public.app_role));
notify pgrst,'reload schema';
