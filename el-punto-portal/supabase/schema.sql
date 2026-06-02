-- El Punto — Food To Go
-- Run this file in the Supabase SQL editor.
-- Keep SUPABASE_SERVICE_ROLE_KEY only in Netlify Functions; never expose it in Vite/frontend code.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  business_name text default 'El Punto',
  subtitle text default 'Food To Go',
  whatsapp_number text,
  google_maps_url text,
  crypto_btc_wallet text,
  crypto_eth_wallet text,
  crypto_usdt_trc20_wallet text,
  crypto_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order integer default 0,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric null,
  cost numeric null,
  ingredient_cost numeric null,
  packaging_cost numeric null,
  discount_price numeric null,
  discount_active boolean not null default false,
  price_label text default 'Precio por confirmar',
  available boolean default true,
  favorite boolean default false,
  badge text,
  sort_order integer default 0,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(category_id, name)
);

create table if not exists public.product_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  name text not null,
  removable boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  image_url text not null,
  storage_path text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

alter table public.products add column if not exists options jsonb not null default '{}'::jsonb;
update public.products set options = '{}'::jsonb where options is null;
alter table public.products alter column options set default '{}'::jsonb;
alter table public.products alter column options set not null;

create index if not exists products_category_sort_idx on public.products (category_id, sort_order, name);
create index if not exists product_ingredients_product_sort_idx on public.product_ingredients (product_id, sort_order);
create index if not exists product_images_product_id_sort_idx on public.product_images (product_id, sort_order, created_at);

drop trigger if exists set_business_settings_updated_at on public.business_settings;
create trigger set_business_settings_updated_at before update on public.business_settings for each row execute function public.set_updated_at();
drop trigger if exists set_categories_updated_at on public.categories;
create trigger set_categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at before update on public.products for each row execute function public.set_updated_at();

alter table public.business_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.product_images enable row level security;

drop policy if exists "Public can read business settings" on public.business_settings;
create policy "Public can read business settings" on public.business_settings for select using (true);

drop policy if exists "Public can read active categories" on public.categories;
create policy "Public can read active categories" on public.categories for select using (active = true);

drop policy if exists "Public can read available products" on public.products;
create policy "Public can read available products" on public.products for select using (available = true and exists (select 1 from public.categories c where c.id = products.category_id and c.active = true));

drop policy if exists "Public can read ingredients for available products" on public.product_ingredients;
create policy "Public can read ingredients for available products" on public.product_ingredients for select using (exists (select 1 from public.products p join public.categories c on c.id = p.category_id where p.id = product_ingredients.product_id and p.available = true and c.active = true));

drop policy if exists "Public can read images for available products" on public.product_images;
create policy "Public can read images for available products" on public.product_images for select using (exists (select 1 from public.products p join public.categories c on c.id = p.category_id where p.id = product_images.product_id and p.available = true and c.active = true));

-- No public insert/update/delete policies are created. Admin writes must go through Netlify Functions with SUPABASE_SERVICE_ROLE_KEY.

insert into public.business_settings (business_name, subtitle, whatsapp_number, google_maps_url)
select 'El Punto', 'Food To Go', '526146087217', 'https://maps.app.goo.gl/aR9oguMm12B9VBtB7'
where not exists (select 1 from public.business_settings);

insert into public.categories (name, slug, sort_order, active) values ('Desayunos', 'desayunos', 0, true) on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, active = true;
insert into public.categories (name, slug, sort_order, active) values ('Birria', 'birria', 1, true) on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, active = true;
insert into public.categories (name, slug, sort_order, active) values ('Bebidas', 'bebidas', 2, true) on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, active = true;
insert into public.categories (name, slug, sort_order, active) values ('Postres', 'postres', 3, true) on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, active = true;

with category_row as (select id from public.categories where slug = 'desayunos'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Huevos al gusto', 'Huevo revuelto o estrellado con proteína, acompañado de papas hashbrown y frijoles.', null, 'Precio por confirmar', true, true, 'Favorito', 0, '[{"name":"Preparación","values":["Revuelto","Estrellado"]},{"name":"Proteína","values":["Jamón","Tocino","Chorizo","Winnie"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'huevo', true, 0),
  ((select id from product_row), 'papas hashbrown', true, 1),
  ((select id from product_row), 'frijoles', true, 2),
  ((select id from product_row), 'proteína', true, 3),
  ((select id from product_row), 'salsa', true, 4);

with category_row as (select id from public.categories where slug = 'desayunos'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Torta de huevo', 'Torta de huevo con aguacate, proteína a elegir, costra de queso, tomate y lechuga.', null, 'Precio por confirmar', true, false, null, 1, '[{"name":"Proteína","values":["Jamón","Tocino","Chorizo","Winnie"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'pan', true, 0),
  ((select id from product_row), 'huevo', true, 1),
  ((select id from product_row), 'aguacate', true, 2),
  ((select id from product_row), 'costra de queso', true, 3),
  ((select id from product_row), 'tomate', true, 4),
  ((select id from product_row), 'lechuga', true, 5),
  ((select id from product_row), 'proteína', true, 6);

with category_row as (select id from public.categories where slug = 'desayunos'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Avena con plátano', 'Avena con plátano acompañada de pan con mantequilla.', null, 'Precio por confirmar', true, false, null, 2, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'avena', true, 0),
  ((select id from product_row), 'plátano', true, 1),
  ((select id from product_row), 'pan', true, 2),
  ((select id from product_row), 'mantequilla', true, 3);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Burrita de birria', 'Burrita acompañada de cebolla picada, limón y cilantro.', null, 'Precio por confirmar', true, false, null, 0, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'tortilla', true, 0),
  ((select id from product_row), 'birria', true, 1),
  ((select id from product_row), 'cebolla', true, 2),
  ((select id from product_row), 'cilantro', true, 3),
  ((select id from product_row), 'limón', true, 4),
  ((select id from product_row), 'salsa', true, 5);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Orden de tacos de birria', 'Orden de 4 piezas en tortilla de maíz o harina.', null, 'Precio por confirmar', true, false, null, 1, '[{"name":"Tortilla","values":["Maíz","Harina"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'birria', true, 0),
  ((select id from product_row), 'tortilla', true, 1),
  ((select id from product_row), 'cebolla', true, 2),
  ((select id from product_row), 'cilantro', true, 3),
  ((select id from product_row), 'limón', true, 4),
  ((select id from product_row), 'salsa', true, 5);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Quesabirria', 'Quesabirria con queso fundido y birria.', null, 'Precio por confirmar', true, false, 'Nuevo', 2, '[{"name":"Tortilla","values":["Maíz","Harina"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'birria', true, 0),
  ((select id from product_row), 'queso', true, 1),
  ((select id from product_row), 'tortilla', true, 2),
  ((select id from product_row), 'cebolla', true, 3),
  ((select id from product_row), 'cilantro', true, 4),
  ((select id from product_row), 'limón', true, 5),
  ((select id from product_row), 'salsa', true, 6);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Torta de birria', 'Torta rellena de birria con acompañamientos.', null, 'Precio por confirmar', true, false, null, 3, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'pan', true, 0),
  ((select id from product_row), 'birria', true, 1),
  ((select id from product_row), 'cebolla', true, 2),
  ((select id from product_row), 'cilantro', true, 3),
  ((select id from product_row), 'limón', true, 4),
  ((select id from product_row), 'salsa', true, 5);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Birriamen', 'Birriamen de 1/2 litro con costra de queso y aguacate.', null, 'Precio por confirmar', true, false, null, 4, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'birria', true, 0),
  ((select id from product_row), 'ramen', true, 1),
  ((select id from product_row), 'consomé', true, 2),
  ((select id from product_row), 'costra de queso', true, 3),
  ((select id from product_row), 'aguacate', true, 4),
  ((select id from product_row), 'cebolla', true, 5),
  ((select id from product_row), 'cilantro', true, 6);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Montado de birria', 'Montado de birria con queso.', null, 'Precio por confirmar', true, false, null, 5, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'tortilla', true, 0),
  ((select id from product_row), 'birria', true, 1),
  ((select id from product_row), 'queso', true, 2),
  ((select id from product_row), 'cebolla', true, 3),
  ((select id from product_row), 'cilantro', true, 4),
  ((select id from product_row), 'limón', true, 5);

with category_row as (select id from public.categories where slug = 'birria'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Consomé', 'Consomé de birria para acompañar.', null, 'Precio por confirmar', true, false, null, 6, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'consomé', true, 0),
  ((select id from product_row), 'cebolla', true, 1),
  ((select id from product_row), 'cilantro', true, 2),
  ((select id from product_row), 'limón', true, 3);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Refresco Coca-Cola', 'Refresco Coca-Cola.', null, 'Precio por confirmar', true, false, null, 0, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'refresco', true, 0);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Jugos frescos de fruta', 'Jugo fresco de fruta de temporada.', null, 'Precio por confirmar', true, false, null, 1, '[{"name":"Sabor","values":["Naranja","Piña","Mango","Temporada"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'fruta de temporada', true, 0);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Jugo verde', 'Jugo verde con piña, pepino, naranja y hoja verde.', null, 'Precio por confirmar', true, false, null, 2, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'piña', true, 0),
  ((select id from product_row), 'pepino', true, 1),
  ((select id from product_row), 'naranja', true, 2),
  ((select id from product_row), 'hoja verde', true, 3);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Limonada', 'Limonada con limón, pepino y chía.', null, 'Precio por confirmar', true, false, null, 3, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'limón', true, 0),
  ((select id from product_row), 'pepino', true, 1),
  ((select id from product_row), 'chía', true, 2),
  ((select id from product_row), 'agua', true, 3);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Jugo rojo', 'Jugo rojo con zanahoria, betabel y frutos rojos. Ingredientes editables en admin.', null, 'Precio por confirmar', true, false, null, 4, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'zanahoria', true, 0),
  ((select id from product_row), 'betabel', true, 1),
  ((select id from product_row), 'frutos rojos', true, 2);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Jugo amarillo', 'Jugo amarillo con mango, zanahoria y naranja.', null, 'Precio por confirmar', true, false, null, 5, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'mango', true, 0),
  ((select id from product_row), 'zanahoria', true, 1),
  ((select id from product_row), 'naranja', true, 2);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Café americano', 'Café americano caliente.', null, 'Precio por confirmar', true, false, null, 6, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'café', true, 0),
  ((select id from product_row), 'agua', true, 1);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Iced americano', 'Iced americano con crema, azúcar y hielo.', null, 'Precio por confirmar', true, false, null, 7, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'café', true, 0),
  ((select id from product_row), 'hielo', true, 1),
  ((select id from product_row), 'crema', true, 2),
  ((select id from product_row), 'azúcar', true, 3);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Iced moka', 'Café frío estilo moka.', null, 'Precio por confirmar', true, false, null, 8, '[]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'café', true, 0),
  ((select id from product_row), 'chocolate', true, 1),
  ((select id from product_row), 'hielo', true, 2),
  ((select id from product_row), 'leche', true, 3);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Malteada', 'Malteada en sabor chocolate, vainilla, Oreo, fresa o mango. Puedes agregar scoop de proteína por $25.', null, 'Precio por confirmar', true, false, null, 9, '[{"name":"Sabor","values":["Chocolate","Vainilla","Oreo","Fresa","Mango"]},{"name":"Proteína","values":["Sin proteína","Agregar scoop +$25"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'leche', true, 0),
  ((select id from product_row), 'helado', true, 1),
  ((select id from product_row), 'saborizante', true, 2);

with category_row as (select id from public.categories where slug = 'bebidas'), product_row as (
  insert into public.products (category_id, name, description, price, price_label, available, favorite, badge, sort_order, options)
  select category_row.id, 'Smoothie con proteína', 'Smoothie con proteína en sabor fresa, mango o moras.', null, 'Precio por confirmar', true, false, null, 10, '[{"name":"Sabor","values":["Fresa","Mango","Moras"]}]'::jsonb from category_row
  on conflict (category_id, name) do update set description = excluded.description, price_label = excluded.price_label, available = excluded.available, favorite = excluded.favorite, badge = excluded.badge, sort_order = excluded.sort_order, options = excluded.options
  returning id
), cleared as (delete from public.product_ingredients where product_id in (select id from product_row))
insert into public.product_ingredients (product_id, name, removable, sort_order) values
  ((select id from product_row), 'fruta', true, 0),
  ((select id from product_row), 'proteína', true, 1),
  ((select id from product_row), 'hielo', true, 2),
  ((select id from product_row), 'base smoothie', true, 3);

insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true) on conflict (id) do nothing;

drop policy if exists "Public can read product image files" on storage.objects;
create policy "Public can read product image files" on storage.objects for select using (bucket_id = 'product-images');

-- Do not add public storage insert/update/delete policies. Uploads/deletes use Netlify Functions.

