-- El Punto — mejoras admin: plataformas, estados de pago y auditoría de edición de tickets.
-- Seguro para datos existentes: solo agrega columnas/constraints/índices y no elimina pedidos.

create extension if not exists pgcrypto;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

alter table public.admin_orders add column if not exists paid_at timestamptz;
alter table public.admin_orders add column if not exists updated_by text;

alter table public.admin_orders drop constraint if exists admin_orders_payment_method_check;
alter table public.admin_orders add constraint admin_orders_payment_method_check check (payment_method in ('efectivo','tarjeta','transferencia','cortesia','plataformas'));

alter table public.admin_orders drop constraint if exists admin_orders_status_check;
alter table public.admin_orders add constraint admin_orders_status_check check (status in ('pendiente','pagado','cancelado'));

update public.admin_orders set updated_by = coalesce(updated_by, captured_by, 'admin') where updated_by is null;
update public.admin_orders set paid_at = coalesce(paid_at, created_at) where status = 'pagado' and paid_at is null;

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
-- Sin políticas públicas: Netlify Functions usan service role + ADMIN_PIN.
