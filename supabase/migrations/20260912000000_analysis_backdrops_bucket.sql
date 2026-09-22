-- Storage bucket for the Analyze scan screen's rotating backdrops.
--
-- One bucket, one folder per sport. The app lists the folder matching the game's
-- sport at scan time, so adding or removing artwork is an upload, never a code
-- change or a redeploy:
--
--   analysis-backdrops/
--     mlb/   <- shown while analysing an MLB game
--     wnba/  <- shown while analysing a WNBA game
--     nba/, nhl/  <- work automatically if artwork is added later
--
-- PUBLIC READ is deliberate. These are decorative images rendered behind a scan
-- animation for every user, they contain no user or model data, and serving them
-- public lets Supabase's CDN cache them. Signed URLs would add per-request churn
-- and expiry handling for zero security benefit.
--
-- WRITES ARE NOT GRANTED to anon or authenticated. No insert/update/delete
-- policy is created, so only the service role and the dashboard owner can upload.
-- That is what keeps a public bucket from becoming an open file drop.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'analysis-backdrops',
  'analysis-backdrops',
  true,
  5242880, -- 5 MB per image; these are backdrops, not print assets
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read-only access for everyone, scoped strictly to this bucket.
drop policy if exists "analysis_backdrops_public_read" on storage.objects;
create policy "analysis_backdrops_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'analysis-backdrops');
