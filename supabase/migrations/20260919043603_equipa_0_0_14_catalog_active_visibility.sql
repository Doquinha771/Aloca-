-- Equipamentos retirados de circulação permanecem visíveis apenas para administradores.
drop policy if exists equipments_select_authenticated on public.equipments;
create policy equipments_select_authenticated on public.equipments
for select to authenticated using (
  private."current_role"() is not null
  and (is_active=true or private."current_role"()='admin'::public.app_role)
);
notify pgrst,'reload schema';
