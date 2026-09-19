-- Teste transacional: cria equipamentos fictícios dentro de uma subtransação e
-- força rollback, sem deixar inventário/retiradas/aceites de teste na escola.
do $t$
declare
 v_admin uuid;
 v_equipment uuid;
 v_linked uuid;
 v_mode text;
 v_linked_mode text;
begin
 select p.id into v_admin from public.profiles p
  where p.role='admin'::public.app_role and p.is_active limit 1;
 if v_admin is null then raise exception 'EQUIPA_NO_ACTIVE_ADMIN_FOR_TEST'; end if;
 begin
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.equipments(code,brand,model,label,created_by)
   values('__EQUIPA014_TEST_'||left(gen_random_uuid()::text,8),'TEST','TEST','TESTE TRANSACIONAL',v_admin)
   returning id into v_equipment;
  select x->>'mode' into v_mode from public.remove_equipment(v_equipment) x;
  if v_mode <> 'deleted' or exists(select 1 from public.equipments where id=v_equipment) then
   raise exception 'EQUIPA_TEST_DELETE_FAILED';
  end if;
  insert into public.equipments(code,brand,model,label,created_by)
   values('__EQUIPA014_LINKED_'||left(gen_random_uuid()::text,8),'TEST','TEST','TESTE TRANSACIONAL',v_admin)
   returning id into v_linked;
  insert into public.reservations(equipment_id,user_id,class_name,destination,start_at,end_at,client_action_id)
   values(v_linked,v_admin,'Teste interno','Teste interno',now()-interval '3 days',now()-interval '2 days',gen_random_uuid());
  select x->>'mode' into v_linked_mode from public.remove_equipment(v_linked) x;
  if v_linked_mode <> 'archived' or not exists(select 1 from public.equipments where id=v_linked and not is_active) then
   raise exception 'EQUIPA_TEST_ARCHIVE_FAILED';
  end if;
  if not exists(select 1 from public.reservations where equipment_id=v_linked) then
   raise exception 'EQUIPA_TEST_HISTORY_LOST';
  end if;
  raise exception 'EQUIPA_TRANSACTION_TEST_ROLLBACK';
 exception when others then
  if sqlerrm='EQUIPA_TRANSACTION_TEST_ROLLBACK' then
   raise notice 'EQUIPA_DELETE_ARCHIVE_HISTORY_PASS';
  else
   raise;
  end if;
 end;
end;
$t$;
