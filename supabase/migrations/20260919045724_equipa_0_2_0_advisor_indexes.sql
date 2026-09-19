-- Avoid duplicate indexes; private idempotency receipts remain inaccessible via the Data API.
drop index if exists public.withdrawals_active_due_idx;
drop index if exists public.reservations_series_start_idx;
create index if not exists equipa_receipts_actor_idx on public.equipa_operation_receipts(actor_id);
create index if not exists equipa_receipts_withdrawal_idx on public.equipa_operation_receipts(withdrawal_id);
drop policy if exists equipa_operation_receipts_no_client_access on public.equipa_operation_receipts;
create policy equipa_operation_receipts_no_client_access on public.equipa_operation_receipts
 for select to authenticated using (false);
notify pgrst,'reload schema';
