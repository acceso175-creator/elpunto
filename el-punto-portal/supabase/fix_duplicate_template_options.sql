-- 1) Ver cuántas filas duplicadas se eliminarán.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        template_id,
        lower(regexp_replace(trim(name), '\s+', ' ', 'g')),
        price_delta
      order by sort_order asc, created_at asc, id asc
    ) as rn
  from public.option_template_items
)
select count(*) as duplicate_rows_to_delete
from ranked
where rn > 1;

-- 2) Limpiar opciones duplicadas dentro de una misma plantilla por nombre normalizado + price_delta.
-- Conserva la primera por menor sort_order, luego menor created_at, luego menor id.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        template_id,
        lower(regexp_replace(trim(name), '\s+', ' ', 'g')),
        price_delta
      order by sort_order asc, created_at asc, id asc
    ) as rn
  from public.option_template_items
), deleted as (
  delete from public.option_template_items
  where id in (
    select id
    from ranked
    where rn > 1
  )
  returning id
)
select count(*) as duplicate_rows_deleted
from deleted;

-- 3) Impedir que vuelvan a crearse duplicados por plantilla + nombre normalizado + price_delta.
create unique index if not exists option_template_items_unique_normalized
on public.option_template_items (
  template_id,
  lower(regexp_replace(trim(name), '\s+', ' ', 'g')),
  price_delta
);
