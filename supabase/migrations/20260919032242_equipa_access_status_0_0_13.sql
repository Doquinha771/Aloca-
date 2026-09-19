create or replace function public.equipa_access_allowed()
returns boolean
language sql stable security invoker set search_path=''
as $$ select private."current_role"() is not null; $$;
revoke all on function public.equipa_access_allowed() from public, anon;
grant execute on function public.equipa_access_allowed() to authenticated;
notify pgrst,'reload schema';
