-- Corrige PGRST204 al guardar pedidos: columnas de quien capturó el pedido.
-- Ejecutar en Supabase SQL Editor después de admin_orders.sql.
-- Puede repetirse: conserva pedidos, nombres existentes y políticas RLS.
begin;

alter table public.admin_orders
  add column if not exists captured_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists captured_by_name text;

-- Mantener el nombre histórico; no inferir el usuario a partir de su nombre.
update public.admin_orders
set captured_by_name = captured_by
where captured_by_name is null;

-- PostgREST debe reconocer las columnas después del commit.
notify pgrst, 'reload schema';

commit;
