

## Plan: Upgrade UFC Fighter Search Dropdown to Match NBA Player Search Design

### What
Restyle both UFC fighter search dropdowns (Fighter 1 and Fighter 2) to match the NBA "Player Search" dropdown design — larger rounded-xl headshot thumbnails, initials fallback, record displayed as a colored badge, "FIGHTERS" section header, and hover chevron.

### Changes — `src/pages/NbaPropsPage.tsx`

**Fighter 1 dropdown (lines 958-981)** and **Fighter 2 dropdown (lines 1027-1051)** — replace both with the NBA-style layout:

1. Add a `"FIGHTERS"` section header at the top of each dropdown (matching the `"PLAYERS"` header in the NBA dropdown)

2. Replace the small `w-8 h-8 rounded-full` headshot with a larger `w-11 h-11 rounded-xl` container with gradient background and border, matching the NBA style

3. Add proper image error handling with a hidden fallback initials div (same pattern as NBA)

4. Show fighter name as `text-[13px] font-bold` with record displayed as a colored accent badge (`text-[10px] font-bold text-accent/70 bg-accent/8 px-1.5 py-0.5 rounded-md`) instead of plain muted text

5. Add a hover chevron arrow on the right side (`ChevronDown -rotate-90`, opacity transition on group hover)

6. Match the `gap-3.5`, `group` class, and `active:bg-accent/10` interaction styles from the NBA dropdown

### No backend changes needed
The UFC search API already returns `headshot` URLs from ESPN — this is purely a frontend styling update.

