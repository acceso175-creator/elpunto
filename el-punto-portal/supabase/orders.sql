-- El Punto — Food To Go: orders + Stripe payments
-- Run this in Supabase SQL editor before enabling Stripe Checkout.
-- Security notes:
-- - Public/anon users do not get insert/update policies for these tables.
-- - Netlify Functions use SUPABASE_SERVICE_ROLE_KEY server-side only and bypass RLS.
-- - Frontend is not the source of truth for prices; checkout recalculates from products in Supabase.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  customer_name text,
  customer_phone text,
  order_type text,
  delivery_address text,
  payment_method text not null,
  payment_status text default 'pending',
  order_status text default 'draft',
  subtotal numeric default 0,
  total numeric default 0,
  currency text default 'mxn',
  notes text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  whatsapp_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null default 1,
  unit_price numeric,
  cost numeric null,
  original_price numeric null,
  discount_price numeric null,
  effective_price numeric null,
  line_profit numeric null,
  line_total numeric,
  selected_options jsonb default '{}'::jsonb,
  removed_ingredients jsonb default '[]'::jsonb,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  provider text default 'stripe',
  provider_status text,
  amount numeric,
  currency text default 'mxn',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  raw_event jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_orders_order_number on public.orders(order_number);
create index if not exists idx_orders_payment_status on public.orders(payment_status);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_payments_order_id on public.payments(order_id);
create index if not exists idx_payments_stripe_checkout_session_id on public.payments(stripe_checkout_session_id);
create index if not exists idx_payments_stripe_payment_intent_id on public.payments(stripe_payment_intent_id);

create or replace function public.set_orders_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_orders_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

-- No anon/authenticated write policies are created intentionally.
-- Add a token-based read policy later if customers need public order lookup.
