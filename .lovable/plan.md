

## Plan: Fix UFC Bet Section Text Wrapping and Spacing

### Problem
In the UFC analysis results, the `BetSection` cards are in a 2-column grid (`grid-cols-2`). The bet text (e.g., "Fight ends by Submission", "Over 1.5 Rounds") wraps character-by-character because the flex row forces the text and badge into too little space. The percentage + badge `shrink-0` group steals width, leaving the bet label only ~3-4 characters wide.

### Changes

**`src/pages/UfcPage.tsx`** — `BetSection` component (lines 231-255):

1. **Change the bet label + badge layout from horizontal to vertical** — Instead of `flex items-center justify-between gap-2`, stack the badge row above or below the bet text. This gives the bet text the full card width.

2. Specifically:
   - Move the probability % and confidence badge to a single line at the top of each prediction card
   - Put the bet text below on its own full-width line
   - Keep reasoning text at the bottom

The updated card layout per prediction:
```
[78%] [STRONG]        ← top row: prob + badge, right-aligned
Over 1.5 Rounds       ← full-width bet label
Most fights go past…  ← reasoning
```

3. **Bet text styling** — Change from `text-xs` to `text-sm` for better readability, and remove `leading-tight` constraint.

### Scope
- 1 file, ~15 lines changed in the `BetSection` component
- Fixes all UFC bet cards (Round Predictions, Method of Victory, Goes the Distance, Sig Strikes, Takedowns)

