-- Prazo da reserva passa a ser a previsão da retirada, na mesma transação.
create or replace function private.checkout_reservation_with_due_internal(
  p_reservation_id bigint,p_client_action_id uuid
) returns text language plpgsql security definer set search_path='' as $$
declare v_withdrawal_id bigint; v_due timestamptz;
begin
 if auth.uid() is null or private."current_role"() is null then
   raise exception 'EQUIPA_ACCOUNT_DISABLED';
 end if;
 select r.end_at into v_due from public.reservations r where r.id=p_reservation_id;
 if v_due is null then raise exception 'DASEIN_RESERVATION_NOT_FOUND'; end if;
 v_withdrawal_id:=private.checkout_reservation_internal(p_reservation_id,p_client_action_id);
 update public.withdrawals w set due_at=v_due where w.id=v_withdrawal_id and w.due_at is null;
 return v_withdrawal_id::text;
end; $$;
revoke all on function private.checkout_reservation_with_due_internal(bigint,uuid) from public,anon;
grant execute on function private.checkout_reservation_with_due_internal(bigint,uuid) to authenticated;
create or replace function public.checkout_reservation_with_due(
 p_reservation_id bigint,p_client_action_id uuid
) returns text language sql security invoker set search_path=''
as $$select private.checkout_reservation_with_due_internal(p_reservation_id,p_client_action_id);$$;
revoke all on function public.checkout_reservation_with_due(bigint,uuid) from public,anon;
grant execute on function public.checkout_reservation_with_due(bigint,uuid) to authenticated;
notify pgrst,'reload schema';
