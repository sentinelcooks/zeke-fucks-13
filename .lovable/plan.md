

## Plan: Fix NHL Analysis Quality & Section Parsing

### Problems Identified

1. **Broken section parser** in `ai-analysis/index.ts` — splits on `**` assuming alternating title/body, but the AI output often has extra `**` markers inside body text, causing misaligned parsing and raw markdown leaking into displayed content.

2. **NHL analysis is too verbose** — despite "2-3 sentences max" instruction, the model generates walls of text. The images show paragraphs of unformatted markdown.

3. **No markdown rendering in WrittenAnalysis.tsx** — content is rendered as plain text in a `<p>` tag, so any `**bold**` markers that survive parsing show as literal asterisks.

---

### Changes

**1. Rewrite the section parser** (`supabase/functions/ai-analysis/index.ts`, lines 320-338)
- Use a regex-based approach: split on `**Title**:` or `**Title:**` patterns to correctly identify section boundaries
- Strip any remaining `**` markers from the body content after extraction
- This prevents the misaligned title/body pairing issue

**2. Tighten NHL & all prompts** (`supabase/functions/ai-analysis/index.ts`)
- Add explicit token/word limits: "Each section MUST be under 50 words"
- Add "Do NOT write paragraphs. Maximum 3 sentences per section. No exceptions."
- Reduce `max_tokens` from 1000 to 600 to hard-cap verbosity
- Add "Strip all markdown formatting from your response — no asterisks, no bold, no bullets"

**3. Strip markdown in WrittenAnalysis.tsx** (line 342-344)
- Add a simple function to clean `**` markers and render clean text
- Replace `{section.content}` with `{cleanMarkdown(section.content)}`

**4. Redeploy the edge function** after changes

### Technical Details

New parser logic:
```
// Split on **Title**: pattern using regex
const sectionRegex = /\*\*([^*]+)\*\*\s*:?\s*/g;
// Extract title and everything until the next **Title** as body
```

Clean markdown helper:
```
const cleanMarkdown = (text: string) => 
  text.replace(/\*\*/g, '').replace(/\*/g, '').trim();
```

