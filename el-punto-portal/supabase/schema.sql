-- El Punto — Food To Go
-- Run this file in the Supabase SQL editor before using image uploads.
-- Keep SUPABASE_SERVICE_ROLE_KEY only in Netlify Functions; never expose it in Vite/frontend code.

create extension if not exists "pgcrypto";

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category text,
  name text not null,
  description text,
  price numeric null,
  available boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.product_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  name text not null,
  removable boolean default true,
  sort_order integer default 0
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  image_url text not null,
  storage_path text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create index if not exists product_images_product_id_sort_idx
  on public.product_images (product_id, sort_order, created_at);

alter table public.products enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.product_images enable row level security;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
  on public.products for select
  using (true);

drop policy if exists "Public can read product ingredients" on public.product_ingredients;
create policy "Public can read product ingredients"
  on public.product_ingredients for select
  using (true);

drop policy if exists "Public can read product images" on public.product_images;
create policy "Public can read product images"
  on public.product_images for select
  using (true);

-- The app uploads/deletes through Netlify Functions with SUPABASE_SERVICE_ROLE_KEY.
-- Do not add public insert/update/delete policies for product_images or storage.objects.
-- For production, replace the PIN check in the function with Supabase Auth + admin roles.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "Public can read product image files" on storage.objects;
create policy "Public can read product image files"
  on storage.objects for select
  using (bucket_id = 'product-images');
