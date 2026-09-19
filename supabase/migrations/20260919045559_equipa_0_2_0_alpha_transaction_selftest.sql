-- Safe transactional regression test. All synthetic data rolls back at the end.
do $outer$
declare a uuid;loc text:='__EQUIPA020_TEST_'||left(gen_random_uuid()::text,12);
 s timestamptz:=date_trunc('minute',now())+interval '10 minutes';
 e timestamptz:=date_trunc('minute',now())+interval '100 minutes';
 occ jsonb;booked jsonb;answer jsonb;again jsonb;
 bid uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();
 rid bigint;wid bigint;eid uuid;other_eid uuid;i integer;
begin
 select id into a from public.profiles where role='admin'::public.app_role and is_active limit 1;
 if a is null then raise notice 'EQUIPA_ALPHA_TEST_SKIPPED_NO_ACTIVE_ADMIN';return;end if;
 begin
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  for i in 1..30 loop
   insert into public.equipments(code,brand,model,label,created_by,school_group,location_text)
    values('__EQUIPA020_'||left(gen_random_uuid()::text,8),'TEST','TEST','TESTE TRANSACIONAL',a,'outro',loc);
  end loop;
  occ:=jsonb_build_array(jsonb_build_object('start_at',s,'end_at',e));
  answer:=public.equipa_preview_quantity('outro',loc,occ);
  if (answer->0->>'available')::integer<>30 then raise exception 'EQUIPA_PREVIEW_30_FAILED';end if;
  booked:=public.equipa_reserve_quantity(30,'outro',loc,'3-A','Teste',occ,'teste',bid);
  if booked->>'ok'<>'true' then raise exception 'EQUIPA_BOOKING_30_FAILED: %',booked;end if;
  again:=public.equipa_reserve_quantity(30,'outro',loc,'3-A','Teste',occ,'teste',bid);
  if again->>'replayed'<>'true' then raise exception 'EQUIPA_REPLAY_FAILED';end if;
  answer:=public.equipa_reserve_quantity(30,'outro',loc,'3-A','Teste',occ,'teste',gen_random_uuid());
  if answer->>'ok'<>'false' or (answer->>'available')::integer<>0 then raise exception 'EQUIPA_SHORTAGE_FAILED: %',answer;end if;
  select id into rid from public.reservations where batch_id=bid order by id limit 1;
  perform public.equipa_booking_action(rid,'checkin','occurrence');
  wid:=public.equipa_checkout_booking(rid,gen_random_uuid())::bigint;
  if (select count(*) from public.withdrawal_items where withdrawal_id=wid)<>30 then raise exception 'EQUIPA_CHECKOUT_30_FAILED';end if;
  if (select count(*) from public.reservations where batch_id=bid and withdrawal_id=wid)<>30 then raise exception 'EQUIPA_RESERVATION_LINK_FAILED';end if;
  select equipment_id into eid from public.withdrawal_items where withdrawal_id=wid order by equipment_id limit 1;
  select equipment_id into other_eid from public.withdrawal_items where withdrawal_id=wid order by equipment_id desc limit 1;
  answer:=public.equipa_return_items(wid,jsonb_build_array(jsonb_build_object('equipment_id',eid,'condition','damaged'),jsonb_build_object('equipment_id',other_eid,'condition','missing')),receipt);
  if (answer->>'pending')::integer<>29 then raise exception 'EQUIPA_PARTIAL_RETURN_FAILED: %',answer;end if;
  if (select status from public.equipments where id=eid)<>'maintenance'::public.equipment_status then raise exception 'EQUIPA_DAMAGED_STATUS_FAILED';end if;
  again:=public.equipa_return_items(wid,jsonb_build_array(jsonb_build_object('equipment_id',eid,'condition','damaged')),receipt);
  if again<>answer then raise exception 'EQUIPA_RETURN_REPLAY_FAILED';end if;
  raise exception 'EQUIPA_TEST_ROLLBACK';
 exception when others then
  if sqlerrm='EQUIPA_TEST_ROLLBACK' then
   raise notice 'EQUIPA_020_PASS: preview,30_reserved,replay,shortage,30_checkout,partial_return,damage,missing,return_replay';
  else raise;end if;
 end;
end $outer$;
