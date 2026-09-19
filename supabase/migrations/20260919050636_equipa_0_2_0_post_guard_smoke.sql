-- After integrity triggers and compact audit: full checkout + damaged return, rollback all synthetic data.
do $outer$
declare a uuid;eid uuid;wid bigint;result jsonb;due timestamptz:=now()+interval '90 minutes';
begin
 select id into a from public.profiles where role='admin'::public.app_role and is_active limit 1;
 if a is null then raise notice 'EQUIPA_POST_GUARD_TEST_SKIPPED';return;end if;
 begin
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.equipments(code,brand,model,label,created_by)
   values('__EQUIPA020_GUARD_'||left(gen_random_uuid()::text,8),'TEST','TEST','Teste transacional',a)
   returning id into eid;
  wid:=public.checkout_with_due(array[eid]::uuid[],'3-A','Teste',null,due,gen_random_uuid())::bigint;
  result:=public.equipa_return_items(wid,jsonb_build_array(jsonb_build_object('equipment_id',eid,'condition','damaged')),gen_random_uuid());
  if result->>'complete'<>'true' then raise exception 'EQUIPA_GUARD_RETURN_FAILED';end if;
  if (select status from public.equipments where id=eid)<>'maintenance'::public.equipment_status then raise exception 'EQUIPA_GUARD_MAINTENANCE_FAILED';end if;
  if not exists(select 1 from public.audit_events where entity_id=eid::text) then raise exception 'EQUIPA_AUDIT_NOT_CREATED';end if;
  raise exception 'EQUIPA_GUARD_TEST_ROLLBACK';
 exception when others then
  if sqlerrm='EQUIPA_GUARD_TEST_ROLLBACK' then raise notice 'EQUIPA_020_GUARD_AUDIT_PASS';
  else raise;end if;
 end;
end $outer$;
