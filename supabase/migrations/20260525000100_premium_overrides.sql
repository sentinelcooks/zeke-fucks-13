-- Trusted premium overrides for owner/admin access.
-- RevenueCat remains authoritative for subscriptions; this table grants
-- backend-managed access independent of store billing.

create table if not exists public.premium_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_type text not null default 'lifetime',
  is_active boolean not null default true,
  reason text,
  granted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint premium_overrides_access_type_not_blank
    check (length(btrim(access_type)) > 0)
);

create index if not exists premium_overrides_user_id_idx
  on public.premium_overrides (user_id);
create index if not exists premium_overrides_active_user_expiration_idx
  on public.premium_overrides (user_id, is_active, expires_at)
  where is_active = true;

alter table public.premium_overrides enable row level security;

drop policy if exists "service_role_manage_premium_overrides" on public.premium_overrides;
create policy "service_role_manage_premium_overrides"
  on public.premium_overrides
  for all
  to service_role
  using (true)
  with check (true);

-- No authenticated write/read policy is created. Overrides are administered
-- through trusted SQL or service-role code only, and status is exposed through
-- the existing entitlement endpoint without revealing grant metadata.

drop trigger if exists set_premium_overrides_updated_at on public.premium_overrides;
create trigger set_premium_overrides_updated_at
  before update on public.premium_overrides
  for each row
  execute function public.set_updated_at();

create or replace function public.has_active_premium(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
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
    )
    or exists (
      select 1
      from public.premium_overrides po
      where po.user_id = target_user_id
        and po.is_active = true
        and (
          po.expires_at is null
          or po.expires_at > now()
        )
    );
$$;

revoke all on function public.has_active_premium(uuid) from public;
grant execute on function public.has_active_premium(uuid) to authenticated, service_role;
