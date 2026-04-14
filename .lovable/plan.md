

## Plan: Fix Long Analysis Text in NHL (and MLB) Moneyline

### Root Cause
The wall-of-text is NOT from the `ai-analysis` edge function (that's working correctly with 3 concise sections). It's from the **`nhl-model` writeup** — a separate AI-generated text block.

Here's the flow:
1. `nhl-model/index.ts` calls `generateWriteup()` which asks the AI to write 3 sections — but with `max_tokens: 600` and NO truncation, the model often writes 400+ words
2. `moneyline-api` prepends `🤖` to the writeup and puts it in `factors`
3. `MoneyLineSection.tsx` line 1614 renders it raw: `{writeupLine.replace("🤖 ", "")}` — no length cap, no markdown stripping

So the "AI Summary" box in the Analysis Breakdown section shows the entire untruncated writeup from the model.

### Fix (3 changes)

**1. Truncate the writeup in `nhl-model/index.ts`** (and `mlb-model/index.ts`)
- After getting the writeup from the AI, truncate it to ~200 chars (2-3 sentences max)
- Reduce `max_tokens` from 600 to 300
- Simplify the prompt to request a single short paragraph instead of 3 sections (the 3-section analysis is already handled by `ai-analysis`)

**2. Truncate on display in `MoneyLineSection.tsx`**
- Add a safety truncation to the writeupLine before rendering (cap at 250 chars, cut at last sentence)
- Strip `**` markdown from the displayed text

**3. Redeploy `nhl-model` and `mlb-model`**

### Files
- `supabase/functions/nhl-model/index.ts` — truncate writeup, simplify prompt
- `supabase/functions/mlb-model/index.ts` — same treatment
- `src/components/MoneyLineSection.tsx` — truncate writeupLine on display

