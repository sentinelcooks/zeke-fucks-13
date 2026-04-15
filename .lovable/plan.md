

## Plan: Fix NHL In-Depth Analysis Verdict Contradiction

### Problem
The AI-generated "Verdict & Risk" section sometimes contradicts the top-level verdict direction (e.g., model says "LEAN OVER" but the writeup says "fade the over"). The CRITICAL instruction only enforces the verdict label ("STRONG PICK", "LEAN", etc.) but doesn't enforce the over/under direction.

### Root Cause
In `supabase/functions/ai-analysis/index.ts`, the CRITICAL instruction says:
> "Your final verdict MUST ALIGN with '${verdict}'"

But `verdict` is just "STRONG PICK" or "LEAN" — it doesn't include the direction (OVER/UNDER). The AI sees conflicting data points and picks its own direction.

### Changes

**`supabase/functions/ai-analysis/index.ts`** — Update all CRITICAL instruction blocks (6 occurrences across prop and moneyline prompts):

Replace each instance of:
```
CRITICAL: Your final verdict MUST ALIGN with "${verdict}" ...
```

With:
```
CRITICAL: Your final verdict MUST ALIGN with "${verdict}" and the direction "${overUnder || 'OVER'}" ${line || "N/A"} — if the model says ${overUnder || "OVER"} ${line || "N/A"}, your Verdict & Risk section MUST recommend ${overUnder || "OVER"} ${line || "N/A"}. Never contradict the top-level recommendation or direction.
```

For moneyline prompts (no overUnder), strengthen to:
```
CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Your Verdict & Risk section must echo this exact recommendation — never contradict the top-level verdict. Support the model's pick decisively.
```

### Scope
- 1 file, ~6 line groups updated
- No frontend changes needed

