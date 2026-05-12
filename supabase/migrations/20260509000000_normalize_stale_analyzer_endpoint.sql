-- Rewrite stale analyzer_endpoint values on pending queue rows so the
-- queue worker calls the correct analyzer. mlb/nhl currently route to
-- nba-api/analyze (mlb-api/analyze was never finished and must not be
-- called). NBA + UFC included for completeness.
--
-- Belt-and-suspenders: process-analyzer-queue also normalizes per-row at
-- runtime (canonicalEndpointForSport), but running this migration cleans
-- the backlog at rest and keeps post-deploy logs quiet.

update public.analyzer_queue
   set analyzer_endpoint = 'nba-api/analyze'
 where status = 'pending'
   and sport in ('nba','mlb','nhl')
   and analyzer_endpoint is distinct from 'nba-api/analyze';

update public.analyzer_queue
   set analyzer_endpoint = 'ufc-api/analyze'
 where status = 'pending'
   and sport = 'ufc'
   and analyzer_endpoint is distinct from 'ufc-api/analyze';
