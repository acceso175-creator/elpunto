-- Perfiles de empleados administradores para capturas manuales.
create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_admin_profiles_updated_at on public.admin_profiles;
create trigger set_admin_profiles_updated_at
before update on public.admin_profiles
for each row execute function public.set_updated_at();

alter table public.admin_profiles enable row level security;

drop policy if exists "Admin profiles read own active profile" on public.admin_profiles;
create policy "Admin profiles read own active profile"
on public.admin_profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admin profiles admins read active profiles" on public.admin_profiles;
create policy "Admin profiles admins read active profiles"
on public.admin_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users current_admin
    where current_admin.user_id = auth.uid()
      and current_admin.active = true
  )
);

-- Sin políticas de insert/update/delete para anon o authenticated: los empleados no pueden cambiar nombre, rol ni estado desde el frontend.

alter table public.admin_orders
add column if not exists captured_by_user_id uuid references auth.users(id);

alter table public.admin_orders
add column if not exists captured_by_name text;

create index if not exists admin_orders_captured_by_user_id_idx on public.admin_orders(captured_by_user_id);
create index if not exists admin_orders_captured_by_name_idx on public.admin_orders(captured_by_name);

-- Crear el perfil inicial de Andrés solo después de confirmar el UUID real en auth.users.
-- Reemplaza UUID_REAL_DEL_USUARIO por el UUID verdadero antes de ejecutar este bloque.
-- insert into public.admin_profiles (user_id, display_name, role, active)
-- values ('UUID_REAL_DEL_USUARIO', 'Andrés', 'admin', true)
-- on conflict (user_id)
-- do update set
--   display_name = excluded.display_name,
--   role = excluded.role,
--   active = excluded.active,
--   updated_at = now();
