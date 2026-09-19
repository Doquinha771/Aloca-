create or replace function private."current_role"()
returns public.app_role
language sql stable security definer set search_path=''
as $$
  select p.role
  from public.profiles p
  left join auth.users u on u.id=p.id
  where p.id=(select auth.uid())
    and p.is_active=true
    and (u.banned_until is null or u.banned_until <= now())
  limit 1;
$$;
notify pgrst,'reload schema';
