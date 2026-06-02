-- El Punto — Food To Go: costos, descuentos y utilidad
-- Ejecutar después de supabase/schema.sql y supabase/orders.sql.

alter table public.products
add column if not exists cost numeric null,
add column if not exists ingredient_cost numeric null,
add column if not exists packaging_cost numeric null,
add column if not exists discount_price numeric null,
add column if not exists discount_active boolean not null default false;

alter table public.order_items
add column if not exists cost numeric null,
add column if not exists original_price numeric null,
add column if not exists discount_price numeric null,
add column if not exists effective_price numeric null,
add column if not exists line_profit numeric null;
