begin;
create extension if not exists pgcrypto;
create table if not exists public.product_option_groups (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  name text not null, required boolean not null default false, selection_type text not null default 'single',
  min_select integer not null default 0, max_select integer not null default 1, sort_order integer not null default 0,
  is_active boolean not null default true, created_at timestamptz not null default now(),
  constraint product_option_groups_name_not_blank check (length(btrim(name)) > 0),
  constraint product_option_groups_selection_type_valid check (selection_type in ('single', 'multiple')),
  constraint product_option_groups_min_select_valid check (min_select >= 0),
  constraint product_option_groups_max_select_valid check (max_select >= 1),
  constraint product_option_groups_selection_range_valid check (max_select >= min_select),
  constraint product_option_groups_single_max_valid check (selection_type <> 'single' or max_select = 1),
  constraint product_option_groups_required_min_valid check (required = false or min_select >= 1)
);
create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.product_option_groups(id) on delete cascade,
  name text not null, price_delta numeric(10,2) not null default 0, is_active boolean not null default true,
  sort_order integer not null default 0, created_at timestamptz not null default now(),
  constraint product_options_name_not_blank check (length(btrim(name)) > 0)
);
create index if not exists product_option_groups_product_sort_idx on public.product_option_groups(product_id, sort_order, created_at);
create index if not exists product_options_group_sort_idx on public.product_options(group_id, sort_order, created_at);
alter table public.product_option_groups enable row level security;
alter table public.product_options enable row level security;
drop policy if exists "Public can read active product option groups" on public.product_option_groups;
create policy "Public can read active product option groups" on public.product_option_groups for select using (is_active = true);
drop policy if exists "Public can read active product options" on public.product_options;
create policy "Public can read active product options" on public.product_options for select using (is_active = true and exists (select 1 from public.product_option_groups g where g.id = group_id and g.is_active = true));
drop policy if exists "Authenticated users can manage product option groups" on public.product_option_groups;
create policy "Authenticated users can manage product option groups" on public.product_option_groups for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users can manage product options" on public.product_options;
create policy "Authenticated users can manage product options" on public.product_options for all to authenticated using (true) with check (true);
commit;
