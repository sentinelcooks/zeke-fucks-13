-- 20260421180000_factor_log_and_calibration.sql
--
-- Sport-agnostic factor logging + calibration + weight store + empty-slate
-- marker + correlation lookup. Backs the v3 calibrated edge_scoring pipeline.

-- ─── factor_log: every sport writes through this ────────────────────
create table if not exists public.factor_log (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  bet_type text not null,
  game_id text not null,
  pick_id uuid references public.daily_picks(id) on delete set null,
  player_name text,
  model_version text not null,
  factor_name text not null,
  score numeric not null,
  weight numeric not null,
  contribution numeric not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists factor_log_sport_game_idx
  on public.factor_log (sport, game_id, created_at desc);
create index if not exists factor_log_pick_idx
  on public.factor_log (pick_id);

alter table public.factor_log enable row level security;
drop policy if exists "service role writes factor_log" on public.factor_log;
create policy "service role writes factor_log"
  on public.factor_log for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Backward-compat view so legacy code reading `nhl_factor_log` still works.
-- (Only replaces the view; does not touch the underlying table, if any.)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'nhl_factor_log') then
    -- Keep the existing table; add a view `nhl_factor_log_v2` that reads factor_log for nhl.
    create or replace view public.nhl_factor_log_v2 as
      select id, game_id, factor_name, score, weight, bet_type, model_version, created_at
      from public.factor_log
      where sport = 'nhl';
  end if;
end $$;

-- ─── model_calibration: nightly Platt / isotonic fits ──────────────
create table if not exists public.model_calibration (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  bet_type text not null,
  method text not null check (method in ('platt','isotonic','identity')),
  params jsonb not null,                 -- {a,b} or {bins:[...]}; {} for identity
  n_samples integer not null default 0,
  brier_score numeric,
  log_loss numeric,
  baseline_brier numeric,
  baseline_log_loss numeric,
  active boolean not null default false,
  fitted_at timestamptz not null default now()
);
create index if not exists model_calibration_active_idx
  on public.model_calibration (sport, bet_type, active, fitted_at desc);

alter table public.model_calibration enable row level security;
drop policy if exists "service role manages calibration" on public.model_calibration;
create policy "service role manages calibration"
  on public.model_calibration for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
drop policy if exists "anyone reads active calibration" on public.model_calibration;
create policy "anyone reads active calibration"
  on public.model_calibration for select
  using (active = true);

-- ─── model_weights: weights live in DB so they can be tuned without redeploy ─
create table if not exists public.model_weights (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  bet_type text not null,
  model_version text not null,
  weights jsonb not null,              -- {factor_name: weight, ...}; must sum ≈ 1
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (sport, bet_type, model_version)
);
create index if not exists model_weights_active_idx
  on public.model_weights (sport, bet_type, active);

alter table public.model_weights enable row level security;
drop policy if exists "service role manages weights" on public.model_weights;
create policy "service role manages weights"
  on public.model_weights for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
drop policy if exists "anyone reads active weights" on public.model_weights;
create policy "anyone reads active weights"
  on public.model_weights for select
  using (active = true);

-- ─── correlation_lookup: optional (sport, prop, prop) → rho overrides ─
create table if not exists public.correlation_lookup (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  prop_type_a text not null,
  prop_type_b text not null,
  same_team boolean not null,
  rho numeric not null check (rho > 0 and rho < 2),
  n_samples integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (sport, prop_type_a, prop_type_b, same_team)
);
alter table public.correlation_lookup enable row level security;
drop policy if exists "service role manages correlations" on public.correlation_lookup;
create policy "service role manages correlations"
  on public.correlation_lookup for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
drop policy if exists "anyone reads correlations" on public.correlation_lookup;
create policy "anyone reads correlations"
  on public.correlation_lookup for select using (true);

-- ─── Empty-slate marker: extend daily_picks so the Home carousel can render
-- a real empty-state instead of blank when no Strong picks exist. ───
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'daily_picks' and column_name = 'status'
  ) then
    alter table public.daily_picks add column status text;
  end if;
end $$;

-- ─── Transactional picks-write RPC (for daily-picks) ──────────────
-- Wipes today's picks + inserts new rows inside a single transaction so
-- a mid-run failure never leaves Today's Edge empty.
create or replace function public.replace_daily_picks(
  p_pick_date date,
  p_rows jsonb,
  p_free_rows jsonb default '[]'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  -- Inside an implicit transaction (function body).
  delete from public.daily_picks where pick_date = p_pick_date;
  delete from public.free_props  where prop_date = p_pick_date;

  if jsonb_array_length(p_rows) > 0 then
    insert into public.daily_picks
      select * from jsonb_populate_recordset(null::public.daily_picks, p_rows);
    get diagnostics inserted_count = row_count;
  end if;

  if jsonb_array_length(p_free_rows) > 0 then
    insert into public.free_props
      select * from jsonb_populate_recordset(null::public.free_props, p_free_rows);
  end if;

  return inserted_count;
end;
$$;

revoke all on function public.replace_daily_picks(date, jsonb, jsonb) from public;
grant execute on function public.replace_daily_picks(date, jsonb, jsonb) to service_role;
