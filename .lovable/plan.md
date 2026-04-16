

## Plan: Unify AI Analysis and Overall Verdict to Prevent Contradictions

### Root Cause
`generateOverallSummary()` (client-side, lines 104-214) and the AI edge function (`ai-analysis`) compute verdicts independently. The overall summary uses multi-signal scoring + model verdict overrides, while the AI narrative gets raw injury context and often writes optimistically even when the model says "RISKY." They never share their conclusions.

### Fix
Compute the overall verdict **first**, then pass it into the AI edge function call so the narrative sections align with the final verdict shown to the user.

**1. `src/components/WrittenAnalysis.tsx`**

- Move `generateOverallSummary` call above the `useEffect` (it's already computed at render — just need to pass it)
- Add `overallRating` to the edge function request body:
  ```typescript
  body: {
    ...existing fields,
    overallRating: overallSummary.rating,  // "take" | "lean" | "fade"
    overallSummary: overallSummary.summary,
  }
  ```
- Add `overallSummary.rating` to the `useEffect` dependency array

**2. `supabase/functions/ai-analysis/index.ts`**

- In `getPropPrompt()`, replace the current "CRITICAL" alignment instruction with one that uses `overallRating`:
  ```
  CRITICAL: The overall verdict for this pick is "${overallRating}".
  - If "fade": Do NOT recommend betting. Acknowledge the risks clearly. Your Verdict & Risk MUST say to pass or avoid.
  - If "lean": Be cautiously optimistic. Mention it's a small-unit play with caveats.
  - If "take": Be assertive and confident. Recommend the bet clearly.
  Never contradict the overall rating. The direction is ${overUnder} ${line}.
  ```
- This replaces the current logic that tries to align with the raw `verdict` string (which the AI often ignores due to conflicting injury instructions)

### Result
The "Verdict & Risk" section in the AI narrative will always match the "Overall Verdict" card below it, because both derive from the same `generateOverallSummary` rating.

### Scope
- 2 files: `WrittenAnalysis.tsx` (pass rating to API call), `ai-analysis/index.ts` (use rating in prompt)

