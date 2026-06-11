begin;

create extension if not exists pgcrypto;

-- public.products.id is uuid in supabase/schema.sql, so product_id must also be uuid.
create table if not exists public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  required boolean not null default false,
  selection_type text not null default 'single',
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.product_option_groups
  add column if not exists product_id uuid references public.products(id) on delete cascade,
  add column if not exists name text,
  add column if not exists required boolean not null default false,
  add column if not exists selection_type text not null default 'single',
  add column if not exists min_select integer not null default 0,
  add column if not exists max_select integer not null default 1,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_option_groups(id) on delete cascade,
  name text not null,
  price_delta numeric not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.product_options
  add column if not exists group_id uuid references public.product_option_groups(id) on delete cascade,
  add column if not exists name text,
  add column if not exists price_delta numeric not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

update public.product_option_groups
set
  selection_type = case when selection_type = 'multiple' then 'multiple' else 'single' end,
  min_select = greatest(case when required then 1 else 0 end, coalesce(min_select, 0)),
  max_select = case when selection_type = 'single' then 1 else greatest(1, coalesce(min_select, 0), coalesce(max_select, 1)) end;

update public.product_options set price_delta = greatest(0, coalesce(price_delta, 0));

alter table public.product_option_groups
  alter column product_id set not null,
  alter column name set not null,
  alter column required set not null,
  alter column selection_type set not null,
  alter column min_select set not null,
  alter column max_select set not null,
  alter column sort_order set not null,
  alter column is_active set not null,
  alter column created_at set not null;

alter table public.product_options
  alter column group_id set not null,
  alter column name set not null,
  alter column price_delta set not null,
  alter column is_active set not null,
  alter column sort_order set not null,
  alter column created_at set not null;

alter table public.product_option_groups
  drop constraint if exists product_option_groups_name_not_blank,
  drop constraint if exists product_option_groups_selection_type_check,
  drop constraint if exists product_option_groups_selection_type_valid,
  drop constraint if exists product_option_groups_min_select_check,
  drop constraint if exists product_option_groups_min_select_valid,
  drop constraint if exists product_option_groups_max_select_check,
  drop constraint if exists product_option_groups_max_select_valid,
  drop constraint if exists product_option_groups_selection_range_check,
  drop constraint if exists product_option_groups_selection_range_valid,
  drop constraint if exists product_option_groups_single_max_check,
  drop constraint if exists product_option_groups_single_max_valid,
  drop constraint if exists product_option_groups_required_min_check,
  drop constraint if exists product_option_groups_required_min_valid,
  add constraint product_option_groups_name_not_blank check (length(btrim(name)) > 0),
  add constraint product_option_groups_selection_type_check check (selection_type in ('single', 'multiple')),
  add constraint product_option_groups_min_select_check check (min_select >= 0),
  add constraint product_option_groups_max_select_check check (max_select >= 1),
  add constraint product_option_groups_selection_range_check check (max_select >= min_select),
  add constraint product_option_groups_single_max_check check (selection_type <> 'single' or max_select = 1),
  add constraint product_option_groups_required_min_check check (required = false or min_select >= 1);

alter table public.product_options
  drop constraint if exists product_options_name_not_blank,
  drop constraint if exists product_options_price_delta_check,
  add constraint product_options_name_not_blank check (length(btrim(name)) > 0),
  add constraint product_options_price_delta_check check (price_delta >= 0);

create index if not exists product_option_groups_product_id_idx on public.product_option_groups(product_id);
create index if not exists product_option_groups_product_sort_idx on public.product_option_groups(product_id, sort_order, created_at);
create index if not exists product_options_group_id_idx on public.product_options(group_id);
create index if not exists product_options_group_sort_idx on public.product_options(group_id, sort_order, created_at);

alter table public.product_option_groups enable row level security;
alter table public.product_options enable row level security;

drop policy if exists "Public can read active product option groups" on public.product_option_groups;
create policy "Public can read active product option groups" on public.product_option_groups for select to anon, authenticated using (is_active = true);

drop policy if exists "Public can read active product options" on public.product_options;
create policy "Public can read active product options" on public.product_options for select to anon, authenticated using (
  is_active = true and exists (
    select 1 from public.product_option_groups groups
    where groups.id = product_options.group_id and groups.is_active = true
  )
);

notify pgrst, 'reload schema';

commit;
