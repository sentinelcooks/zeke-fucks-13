

## Plan: Fix B2B Status Display + Add Explainer Popup

### Current state
- **Backend** (`moneyline-api/index.ts` line 282): `detectBackToBack` returns `{ isB2B, lastGameDate, nextGameDate }`. No starter-minutes data.
- **Frontend** (`MoneyLineSection.tsx` lines 1825-1842): Shows a Moon "B2B" badge if `isB2B`, else a green ✓. Per the user's screenshot, both Hornets and Magic show ✅ — meaning neither is on a B2B, but the visual reads ambiguously and there's no explainer.

### User-requested semantics (the inversion)
- ✅ checkmark = team **IS** on a back-to-back
- ❌ X = team **IS NOT** on a back-to-back
- Tap either icon → popup with team-specific explanation, including dynamic risk level (low/medium/high) when starter-minutes data is available, else default to "medium."

### Changes

**1. Backend — `supabase/functions/moneyline-api/index.ts`** (`detectBackToBack`, ~line 282)

Extend the return object with a `b2bRisk` field. Compute it from previous-game starter minutes when available:
- Find the team's most recent completed game (the day-before game when `isB2B`).
- Pull the boxscore via ESPN's `/summary?event={id}` endpoint (already used elsewhere for splits).
- Count starters with >35 min played: `>=3 → "high"`, `1-2 → "medium"`, `0 → "low"`.
- If boxscore fetch fails or sport doesn't track minutes the same way (MLB/NHL), default to `"medium"` when `isB2B === true`, `null` when not on B2B.
- Wrap in try/catch — must not break the analyze response if ESPN summary 404s.

Return shape:
```ts
{ isB2B: boolean, lastGameDate: string|null, nextGameDate?: string, b2bRisk: "low"|"medium"|"high"|null }
```

This applies automatically across NBA, MLB, NHL, NFL, NCAAB since `detectBackToBack` is sport-agnostic and called for all sports in the analyze flow (lines 1026-1027).

**2. Frontend — `src/components/MoneyLineSection.tsx`**

a. **Invert the icon semantics** (lines 1832-1838):
   - `isB2B === true` → green ✅ checkmark (`Check` from lucide-react)
   - `isB2B === false` → red ❌ X (`X` from lucide-react, already imported)

b. **Wrap each row in a `<button>`** mirroring the Pace card pattern (lines 1847-1869). Add new state `b2bInfo` of type `{ team, b2b } | null`.

c. **Add an explainer modal** at the bottom of the section, alongside the existing Pace modal. Reuse the same `framer-motion` AnimatePresence + Vision UI styling already used by the Pace popup. Content:
   - **Not B2B:** *"{Team} is not playing on a back-to-back. No fatigue risk from travel or short rest — this is a neutral factor for this matchup."*
   - **On B2B:** *"{Team} is playing on a back-to-back. They played a game yesterday and are on short rest today. Back-to-back games can impact performance — fatigue, reduced minutes for star players, and lower energy late in games are common. This adds {risk} risk to the play depending on how many key players logged heavy minutes last night."* — where `{risk}` comes from `b2b.b2bRisk` or defaults to `"medium"`.
   - Dismiss on backdrop click + X button (same pattern as Pace modal).

### Verification (mandatory before complete)
1. Deploy `moneyline-api`.
2. `supabase--curl_edge_functions` POST `/moneyline-api/analyze` for an NBA matchup where one team played yesterday → grep response for `back_to_back.team1.b2bRisk` and confirm field present with value `"low"|"medium"|"high"|null`. Paste the slice.
3. Repeat for MLB and NHL matchups → confirm field present (likely `"medium"` default or `null`).
4. UI smoke: load Analyze → Moneyline → Lines → run a matchup → tap each B2B row → confirm popup opens with correct text and dismisses on X / backdrop.

### Out of scope
- No DB/schema changes.
- No changes to other tabs (Props, Slip, Games).
- No changes to the B2B factor weight/scoring inside `runModel` — only the display + risk metadata.

