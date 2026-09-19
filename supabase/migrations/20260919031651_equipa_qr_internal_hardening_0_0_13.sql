create or replace function private.scan_qr_internal(p_token uuid)
returns table(kind text,qr_token uuid,display_name text,code text,asset_tag text,brand text,model text,status public.equipment_status,item_count bigint)
language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null or private."current_role"() is null then raise exception 'EQUIPA_ACCOUNT_DISABLED'; end if;
  return query
  select 'equipment'::text,e.qr_token,coalesce(nullif(btrim(e.label),''),e.code),e.code,e.asset_tag,e.brand,e.model,e.status,null::bigint
  from public.equipments e where e.qr_token=p_token and e.is_active limit 1;
  if found then return; end if;
  return query
  select 'cart'::text,c.qr_token,coalesce(nullif(btrim(c.name),''),'Carrinho '||c.number::text),c.number::text,null::text,null::text,null::text,null::public.equipment_status,count(ci.equipment_id)::bigint
  from public.equipment_carts c left join public.equipment_cart_items ci on ci.cart_id=c.id
  where c.qr_token=p_token and c.is_active group by c.id limit 1;
end;
$$;
revoke all on function private.scan_qr_internal(uuid) from public, anon;
grant execute on function private.scan_qr_internal(uuid) to authenticated;
notify pgrst,'reload schema';
