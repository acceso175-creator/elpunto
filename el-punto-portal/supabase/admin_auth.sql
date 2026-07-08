create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists admin_users_email_idx on public.admin_users (lower(email));

alter table public.admin_users enable row level security;

drop policy if exists "Admin can read own record" on public.admin_users;
create policy "Admin can read own record"
on public.admin_users
for select
to authenticated
using (auth.uid() = user_id);
