-- Internal trigger functions are not directly executable through public client roles.
revoke all on function private.expire_unclaimed_reservations_internal() from public,anon;
grant execute on function private.expire_unclaimed_reservations_internal() to authenticated;
revoke all on function private.reject_reserved_checkout() from public,anon,authenticated;
revoke all on function private.equipa_guard_equipment_state() from public,anon,authenticated;
revoke all on function private.audit_row_change() from public,anon,authenticated;
notify pgrst,'reload schema';
