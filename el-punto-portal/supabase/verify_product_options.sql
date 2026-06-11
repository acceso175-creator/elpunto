-- Diagnóstico de tablas, tipos y políticas para opciones seleccionables.
-- Este archivo no modifica datos.
select to_regclass('public.product_option_groups') as product_option_groups_table;
select to_regclass('public.product_options') as product_options_table;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'product_option_groups'
order by ordinal_position;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'product_options'
order by ordinal_position;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
order by ordinal_position;

select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('products', 'product_option_groups', 'product_options');

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('products', 'product_option_groups', 'product_options')
order by tablename, policyname;
