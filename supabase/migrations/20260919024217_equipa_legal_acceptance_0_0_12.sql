-- Equipa 0.0.12 — registro de aceite dos documentos legais.
create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null check (char_length(terms_version) between 1 and 40),
  privacy_version text not null check (char_length(privacy_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  source text not null default 'web' check (source in ('web')),
  unique (user_id, terms_version, privacy_version)
);
create index if not exists legal_acceptances_user_accepted_idx on public.legal_acceptances (user_id, accepted_at desc);
alter table public.legal_acceptances enable row level security;
drop policy if exists legal_acceptances_select_own on public.legal_acceptances;
create policy legal_acceptances_select_own on public.legal_acceptances for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.legal_acceptances from anon;
revoke insert, update, delete on table public.legal_acceptances from authenticated;
grant select on table public.legal_acceptances to authenticated;
create or replace function private.accept_legal_documents_internal(p_terms_version text,p_privacy_version text)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'EQUIPA_NOT_AUTHENTICATED'; end if;
  if nullif(btrim(p_terms_version),'') is null or nullif(btrim(p_privacy_version),'') is null
     or char_length(btrim(p_terms_version)) > 40 or char_length(btrim(p_privacy_version)) > 40 then
    raise exception 'EQUIPA_LEGAL_VERSION_INVALID';
  end if;
  insert into public.legal_acceptances(user_id,terms_version,privacy_version,accepted_at,source)
  values(v_user,btrim(p_terms_version),btrim(p_privacy_version),now(),'web')
  on conflict(user_id,terms_version,privacy_version)
  do update set accepted_at=excluded.accepted_at, source=excluded.source;
end;$$;
revoke all on function private.accept_legal_documents_internal(text,text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.accept_legal_documents_internal(text,text) to authenticated;
create or replace function public.accept_legal_documents(p_terms_version text,p_privacy_version text)
returns void language sql security invoker set search_path='' as $$ select private.accept_legal_documents_internal(p_terms_version,p_privacy_version); $$;
revoke all on function public.accept_legal_documents(text,text) from public, anon;
grant execute on function public.accept_legal_documents(text,text) to authenticated;
create or replace function public.has_current_legal_acceptance(p_terms_version text,p_privacy_version text)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.legal_acceptances la where la.user_id=(select auth.uid()) and la.terms_version=p_terms_version and la.privacy_version=p_privacy_version);
$$;
revoke all on function public.has_current_legal_acceptance(text,text) from public, anon;
grant execute on function public.has_current_legal_acceptance(text,text) to authenticated;
