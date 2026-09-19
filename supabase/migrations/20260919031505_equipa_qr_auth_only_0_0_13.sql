revoke execute on function public.scan_qr(uuid) from public, anon;
grant execute on function public.scan_qr(uuid) to authenticated;
notify pgrst, 'reload schema';
