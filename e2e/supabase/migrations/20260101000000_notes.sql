-- A minimal per-user table for the data-access scenarios. The test apps use
-- the admin client (service_role) and scope by user_id (authorization in the
-- API layer); RLS is enabled as good practice (service_role bypasses it).
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- Newer Supabase stacks make new tables private by default: the API roles
-- (anon / authenticated / service_role) get no DML privileges, so access
-- must be granted explicitly. The e2e apps only touch this table through
-- the admin client (service_role).
grant select, insert on public.notes to service_role;
