
## Plan: Restore NBA Odds Visibility

### What I found
The main blocker is not just the screen:
- The backend odds key pool is exhausted right now: **3/3 keys are exhausted** and each shows **0 requests remaining** with `OUT_OF_USAGE_CREDITS`.
- The moneyline UI currently **fails silently**. In `MoneylinePlatformOdds`, if no lines come back it returns `null`, so you see nothing instead of a reason.
- There is also a likely NBA-specific matching weakness: the frontend odds matcher only compares `name` and `shortName`, not team aliases. That can miss teams like **LA Lakers / Los Angeles Lakers**, **NY Knicks / New York Knicks**, etc.

### What I’ll do
**1. Fix the backend odds flow**
- Update `supabase/functions/moneyline-api/index.ts` to use the **same rotating odds-key strategy** as `nba-odds` instead of relying on a single fallback path.
- Return a structured odds status when lines cannot load, e.g.:
  - `no_credits`
  - `no_market_found`
  - `no_active_lines`

**2. Fix the NBA odds matching**
- Update `src/components/MoneyLineSection.tsx` so matchup detection uses:
  - full name
  - short name
  - abbreviation
  - aliases from the team payload
  - nickname/suffix matching
- Reuse the stronger matching concept already used in the backend so NBA teams resolve more reliably.

**3. Stop hiding the odds section**
- Replace the current silent `return null` behavior with a visible fallback card:
  - “Live odds temporarily unavailable”
  - “No active lines for this matchup”
  - “Odds feed is out of credits”
- Keep the section layout intact so the page still looks complete.

**4. Use whatever odds are available**
- If the full multi-book odds panel fails, keep showing any usable odds returned from `results.odds` instead of hiding everything.
- This gives the user at least one best-line card while the richer comparison panel is unavailable.

**5. Verify end-to-end**
- Test NBA moneyline, spreads, and totals after the code changes.
- Confirm the UI shows:
  - real odds when credits are available
  - a clear message when credits are exhausted
  - no blank/vanishing odds area

### Important blocker
Even after the code fix, **live odds will not reappear until fresh Odds API quota is available**. The current backend key pool is fully exhausted, so part of the fix is restoring valid odds credits in the existing admin odds-key flow.

### Files involved
- `src/components/MoneyLineSection.tsx`
- `supabase/functions/moneyline-api/index.ts`
- Possibly shared helper extraction from `supabase/functions/nba-odds/index.ts` for consistent key rotation / matching behavior
