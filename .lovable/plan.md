

## Plan: Fix NHL Analysis Wall-of-Text

### Root Cause
Two problems:
1. **Parser only matches `**Title**:` format** — but the AI model sometimes outputs `### Title` markdown headers instead. When this happens, the regex finds 0 matches and the fallback just takes the first 3 non-empty lines, which can be massive paragraphs.
2. **Model ignores word limits** — despite "50 words max" instructions, it writes 200+ word paragraphs. No server-side truncation exists as a safety net.

### Changes

**1. Fix the section parser** (`supabase/functions/ai-analysis/index.ts`, lines 325-352)
- Add a second regex pass for `### Title` / `## Title` patterns if `**Title**:` yields 0 matches
- Also try splitting on numbered patterns like `1. Title:` or `1) Title:`
- This ensures the parser handles whatever format the model decides to use

**2. Add hard content truncation** (same file, after parsing)
- After extracting each section body, truncate to 280 characters max (roughly 50 words)
- Cut at the last complete sentence within the limit if possible
- This acts as a safety net regardless of how verbose the model is

**3. Strengthen the prompt** (same file, NHL moneyline prompt + system message)
- Add: "You MUST write ONLY 3 short bullet-style sentences per section. If you write more than 50 words in any section, the output will be rejected."
- Switch from `google/gemini-3-flash-preview` to `google/gemini-2.5-flash` which follows formatting instructions more reliably

**4. Redeploy the `ai-analysis` edge function**

### Technical Details

New parser fallback chain:
```
1. Try **Title**: regex
2. If 0 matches → try ### Title regex  
3. If 0 matches → try numbered "1. Title:" regex
4. If still 0 → split on double newlines, take first 3 chunks
```

Truncation helper:
```typescript
function truncateSection(text: string, maxChars = 280): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSentence = cut.lastIndexOf('.');
  return lastSentence > 100 ? cut.slice(0, lastSentence + 1) : cut + '…';
}
```

