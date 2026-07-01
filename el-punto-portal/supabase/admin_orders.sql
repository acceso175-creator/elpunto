-- Pedidos capturados manualmente desde admin y soporte para cortes.
create extension if not exists pgcrypto;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create sequence if not exists public.admin_order_number_seq;

create table if not exists public.admin_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null default ('ADM-' || to_char(now() at time zone 'America/Chihuahua', 'YYYYMMDD') || '-' || lpad(nextval('public.admin_order_number_seq')::text, 6, '0')),
  customer_name text,
  customer_phone text,
  order_type text not null check (order_type in ('mostrador','domicilio','recoger')),
  payment_method text not null check (payment_method in ('efectivo','tarjeta','transferencia','cortesia','plataformas')),
  status text not null default 'pagado' check (status in ('pendiente','pagado','cancelado')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  total numeric(12,2) not null check (total >= 0),
  notes text,
  captured_by text not null check (length(trim(captured_by)) > 0),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.admin_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null, product_name text not null,
  quantity integer not null check (quantity >= 1), unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0), selected_options jsonb, item_notes text,
  created_at timestamptz not null default now()
);
create index if not exists admin_orders_created_at_idx on public.admin_orders(created_at desc);
create index if not exists admin_orders_status_idx on public.admin_orders(status);
create index if not exists admin_order_items_order_id_idx on public.admin_order_items(order_id);
drop trigger if exists set_admin_orders_updated_at on public.admin_orders;
create trigger set_admin_orders_updated_at before update on public.admin_orders for each row execute function public.set_updated_at();
alter table public.admin_orders enable row level security;
alter table public.admin_order_items enable row level security;
-- Sin políticas públicas: las operaciones pasan por Netlify con service role y ADMIN_PIN.
create index if not exists admin_orders_payment_method_idx on public.admin_orders(payment_method);
create index if not exists admin_orders_captured_by_idx on public.admin_orders(captured_by);

create table if not exists public.order_edit_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.admin_orders(id) on delete cascade,
  previous_data jsonb not null default '{}'::jsonb,
  new_data jsonb not null default '{}'::jsonb,
  reason text not null check (length(trim(reason)) > 0),
  edited_by text not null default 'admin',
  created_at timestamptz not null default now()
);
create index if not exists admin_orders_platform_pending_idx on public.admin_orders(payment_method, status, created_at desc) where payment_method = 'plataformas';
create index if not exists admin_orders_paid_at_idx on public.admin_orders(paid_at desc);
create index if not exists order_edit_history_order_id_idx on public.order_edit_history(order_id, created_at desc);
alter table public.order_edit_history enable row level security;
