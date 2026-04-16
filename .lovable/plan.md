

## Plan: Add Auth Trigger + Redeploy + Full Verification

### What's Being Done

1. **Migration** — `supabase/migrations/<ts>_add_auth_user_trigger.sql`:
   ```sql
   drop trigger if exists on_auth_user_created on auth.users;
   create trigger on_auth_user_created
     after insert on auth.users
     for each row execute function public.handle_new_user();
   ```

2. **Redeploy all 21 edge functions** in one batch so they bind to the new project's env:
   `nba-api`, `mlb-model`, `nhl-model`, `ufc-api`, `moneyline-api`, `ai-analysis`, `daily-picks`, `nba-odds`, `log-outcome`, `admin-onboarding`, `correlated-props`, `free-props`, `games-schedule`, `grade-picks`, `key-admin`, `key-auth`, `prop-explainer`, `revenuecat-entitlements`, `session-cleanup`, `trends-api`, `personalize`

3. **Run live verification — paste all 6 outputs in the completion message:**

   **A. Database + table count**
   ```sql
   select current_database(), count(*) as table_count
   from information_schema.tables where table_schema='public';
   ```

   **B. Snapshot logging works** — call `nba-api/analyze` with a real player, wait, then:
   ```sql
   select sport, count(*), max(created_at) from prediction_snapshots group by sport;
   ```

   **C. Edge function deployment status** — paste deploy result for all 21.

   **D. Secrets present** — confirm all 8 user-managed secrets exist (no missing list).

   **E. Trigger exists**
   ```sql
   select trigger_name, event_manipulation, event_object_table
   from information_schema.triggers where trigger_name='on_auth_user_created';
   ```

   **F. Trigger actually fires** — sign up a synthetic test user via `supabase.auth.admin.createUser` (invoked through a temporary admin call or directly via the REST `auth/v1/admin/users` endpoint using `SUPABASE_SERVICE_ROLE_KEY`), then:
   ```sql
   select id, email, created_at from public.profiles order by created_at desc limit 3;
   ```
   Confirm the new test user's row appears. If trigger fires but no profile row, inspect `handle_new_user()` body and report the bug.

   Test user will be cleaned up after verification (delete the test auth user + profile row).

### Out of Scope
- No new tables (all 21 exist)
- No frontend changes
- No data migration

