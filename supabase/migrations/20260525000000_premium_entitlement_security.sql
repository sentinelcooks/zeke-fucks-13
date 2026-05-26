-- Premium entitlement, trial-abuse, and account-sharing hardening.
-- RevenueCat remains the source of truth. These tables are a server-owned
-- cache/audit layer used by Edge Functions and RLS to fail closed.

create table if not exists public.user_subscription_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revenuecat_app_user_id text not null,
  original_app_user_id text,
  original_transaction_id text,
  entitlement_id text not null default 'premium',
  is_active boolean not null default false,
  product_id text,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  latest_expiration_at timestamptz,
  will_renew boolean,
  status_reason text,
  last_checked_at timestamptz not null default now(),
  raw_revenuecat jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement_id)
);

create index if not exists user_subscription_status_user_id_idx
  on public.user_subscription_status (user_id);
create index if not exists user_subscription_status_revenuecat_app_user_id_idx
  on public.user_subscription_status (revenuecat_app_user_id);
create index if not exists user_subscription_status_entitlement_active_idx
  on public.user_subscription_status (entitlement_id, is_active, last_checked_at desc);
create index if not exists user_subscription_status_original_transaction_id_idx
  on public.user_subscription_status (original_transaction_id)
  where original_transaction_id is not null;

alter table public.user_subscription_status enable row level security;

drop policy if exists "users_read_own_subscription_status" on public.user_subscription_status;
create policy "users_read_own_subscription_status"
  on public.user_subscription_status
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "service_role_manage_subscription_status" on public.user_subscription_status;
create policy "service_role_manage_subscription_status"
  on public.user_subscription_status
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null,
  device_id_hash text,
  revenuecat_app_user_id text,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_security_events_user_id_idx
  on public.account_security_events (user_id, created_at desc);
create index if not exists account_security_events_event_type_idx
  on public.account_security_events (event_type, created_at desc);
create index if not exists account_security_events_device_id_hash_idx
  on public.account_security_events (device_id_hash, created_at desc)
  where device_id_hash is not null;
create index if not exists account_security_events_revenuecat_app_user_id_idx
  on public.account_security_events (revenuecat_app_user_id, created_at desc)
  where revenuecat_app_user_id is not null;

alter table public.account_security_events enable row level security;

drop policy if exists "users_read_own_security_events" on public.account_security_events;
create policy "users_read_own_security_events"
  on public.account_security_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "service_role_manage_security_events" on public.account_security_events;
create policy "service_role_manage_security_events"
  on public.account_security_events
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.blocked_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id_hash text,
  reason text not null,
  blocked_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists blocked_sessions_user_active_idx
  on public.blocked_sessions (user_id, revoked_at, blocked_at desc);
create index if not exists blocked_sessions_device_active_idx
  on public.blocked_sessions (device_id_hash, revoked_at, blocked_at desc)
  where device_id_hash is not null;

alter table public.blocked_sessions enable row level security;

drop policy if exists "service_role_manage_blocked_sessions" on public.blocked_sessions;
create policy "service_role_manage_blocked_sessions"
  on public.blocked_sessions
  for all
  to service_role
  using (true)
  with check (true);

alter table public.user_devices
  add column if not exists app_version text,
  add column if not exists user_agent text,
  add column if not exists ip_hash text;

create index if not exists user_devices_device_id_hash_idx
  on public.user_devices (device_id_hash);
create index if not exists user_devices_user_status_last_seen_idx
  on public.user_devices (user_id, status, last_seen desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_subscription_status_updated_at on public.user_subscription_status;
create trigger set_user_subscription_status_updated_at
  before update on public.user_subscription_status
  for each row
  execute function public.set_updated_at();

create or replace function public.has_active_premium(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_subscription_status uss
    where uss.user_id = target_user_id
      and uss.entitlement_id = 'premium'
      and uss.is_active = true
      and uss.last_checked_at > now() - interval '30 minutes'
      and (
        uss.latest_expiration_at is null
        or uss.latest_expiration_at > now()
      )
  );
$$;

revoke all on function public.has_active_premium(uuid) from public;
grant execute on function public.has_active_premium(uuid) to authenticated, service_role;

drop policy if exists "Anyone can read daily picks" on public.daily_picks;
drop policy if exists "Premium users can read daily picks" on public.daily_picks;
create policy "Premium users can read daily picks"
  on public.daily_picks
  for select
  to authenticated
  using (public.has_active_premium(auth.uid()));

drop policy if exists "Authenticated users can read free_props" on public.free_props;
drop policy if exists "Premium users can read free_props" on public.free_props;
create policy "Premium users can read free_props"
  on public.free_props
  for select
  to authenticated
  using (public.has_active_premium(auth.uid()));

drop policy if exists "Authenticated users can read correlated_props" on public.correlated_props;
drop policy if exists "Premium users can read correlated_props" on public.correlated_props;
create policy "Premium users can read correlated_props"
  on public.correlated_props
  for select
  to authenticated
  using (public.has_active_premium(auth.uid()));
