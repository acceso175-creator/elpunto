create extension if not exists pgcrypto;

create table if not exists public.option_group_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  selection_type text not null default 'single' check (selection_type in ('single','multiple')),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_group_templates_select_range check (max_select >= min_select)
);
create table if not exists public.option_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.option_group_templates(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  price_delta numeric(10,2) not null default 0 check (price_delta >= 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.product_option_templates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  template_id uuid not null references public.option_group_templates(id) on delete cascade,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(product_id, template_id)
);
create index if not exists option_group_templates_active_idx on public.option_group_templates(active, name);
create index if not exists option_template_items_template_idx on public.option_template_items(template_id, active, sort_order);
create unique index if not exists option_template_items_unique_normalized on public.option_template_items (template_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')), price_delta);
create index if not exists product_option_templates_product_idx on public.product_option_templates(product_id, active, sort_order);
create index if not exists product_option_templates_template_idx on public.product_option_templates(template_id);
create or replace function public.set_option_group_templates_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists set_option_group_templates_updated_at on public.option_group_templates;
create trigger set_option_group_templates_updated_at before update on public.option_group_templates for each row execute function public.set_option_group_templates_updated_at();
alter table public.option_group_templates enable row level security;
alter table public.option_template_items enable row level security;
alter table public.product_option_templates enable row level security;
drop policy if exists "Public read active option templates" on public.option_group_templates;
create policy "Public read active option templates" on public.option_group_templates for select using (active = true);
drop policy if exists "Public read active option template items" on public.option_template_items;
create policy "Public read active option template items" on public.option_template_items for select using (active = true);
drop policy if exists "Public read active product option templates" on public.product_option_templates;
create policy "Public read active product option templates" on public.product_option_templates for select using (active = true);
-- No public insert/update/delete policies. Admin Netlify functions use SUPABASE_SERVICE_ROLE_KEY.
