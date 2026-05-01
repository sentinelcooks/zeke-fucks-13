-- Phone-only account-sharing protection.
-- Tracks active mobile devices per Supabase auth user. Only the server-side
-- hash of the device ID is stored; raw device IDs never reach the database.

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id_hash text not null,
  platform text not null default 'ios',
  device_label text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, device_id_hash)
);

create index if not exists user_devices_user_status_idx
  on public.user_devices (user_id, status);

alter table public.user_devices enable row level security;

-- Users can read their own devices (used by the manage UI fallback path).
drop policy if exists "users_read_own_devices" on public.user_devices;
create policy "users_read_own_devices"
  on public.user_devices
  for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies: service role (used by Edge Functions)
-- bypasses RLS, and direct writes from the client are forbidden.
