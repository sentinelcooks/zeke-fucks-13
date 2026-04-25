# AI Provider Routing Rules

## Provider Priority Order

All AI text generation in Sentinel must follow this routing chain. Never hard-wire a single provider.

### 1. Primary: Grok 4.1 Fast Reasoning
- Model: `grok-4-1-fast-reasoning` via xAI API (`https://api.x.ai/v1/chat/completions`)
- Required secret: `GROK_API_KEY`
- Do NOT send `temperature`, `presencePenalty`, `frequencyPenalty`, `stop`, or `reasoning_effort` — reasoning models don't support these fields
- Use for all standard analysis, prop writeups, and narrative generation

### 2. Backup: Grok Mini
- Model: `grok-3-mini` — same key and endpoint as above
- Supports `temperature` and all standard OpenAI-compatible parameters

### 3. Optional: Gemini Flash-Lite
- Model: `gemini-2.0-flash-lite`
- Required secret: `GEMINI_API_KEY` — optional; if absent, this provider is skipped cleanly
- Uses Google's `generateContent` API (different schema from OpenAI-compatible)
- Tool calls use `functionDeclarations` format; strip `additionalProperties` before sending

### 4. Optional: OpenAI
- Model: `gpt-4o-mini`
- Required secret: `OPENAI_API_KEY` — optional; if absent, this provider is skipped cleanly
- **Never hard-require OpenAI.** No function should fail if the OpenAI key is missing or rate-limited.

### 5. Final fallback: Meaningful static text
- If all AI providers fail or are unavailable, return a meaningful fallback string — never an empty string, `null`, or a generic "Analysis unavailable" with no context.
- The fallback must reference the player name, prop type, and the fact that analysis could not be generated, e.g.: `"Could not generate AI analysis for [Player] [PropType] at this time. Review the stats above for context."`

---

## Analysis Quality Rules

### No blank or generic outputs
Every analysis function that calls an AI provider must:
- Pass the actual player stats, matchup data, prop line, and sport context into the prompt
- Return text that references those specifics
- Never return a copy-paste of a previous analysis or a generic template

### Tailor to the actual data
Analysis must reference:
- The specific player and their recent stats
- The prop type and line being analyzed
- The matchup context (opponent, defense rating, pace, etc.)
- Sport-specific factors (injury report, back-to-back, weather for MLB, etc.)
- Any unusual edges or risk factors present in the data

### Cite exact data fields
Do not paraphrase or generalize. If a player is averaging 28.4 points on 22.1 FGA, say that. If opponent allows 118.3 points per 100 possessions, cite it. Betting angle must be explained explicitly (why over, why under, what edge, what risk).

### Acknowledge uncertainty
If a key data field is missing (e.g., no injury report, no recent pace data), say so explicitly rather than filling the gap with confident-sounding language.

### Sport-specific reasoning requirements
- **NBA**: usage rate, pace, matchup defense (points allowed at position), back-to-back fatigue
- **MLB**: pitcher ERA/WHIP/K-rate, park factors, platoon splits, bullpen state
- **NHL**: Corsi, PP%, goalie save%, road/home splits, line matchups
- **UFC**: finishing rate, reach/height differentials, grappling vs striking tendencies, fight camp signals

### No repeated generic paragraphs
If analysis text is being generated for 10 different props, each paragraph must be distinct and data-driven. A human reviewer looking at two outputs should be able to immediately tell they're for different props.

---

## Implementation Rules

### In `supabase/functions/_shared/ai-provider.ts`
- This is the canonical routing module — do not duplicate provider-switching logic in individual Edge Functions
- Any new provider must be added here first
- Provider order must match the priority chain above
- Include try/catch per provider with logging before falling through to next
- The `skipTemperature` parameter in `tryOpenAICompat` must be set to `true` for `grok-4-1-fast-reasoning`

### In Edge Functions that call AI
- Import from `_shared/ai-provider.ts`, do not inline provider keys
- Never embed API keys in function code — use Supabase secrets (`Deno.env.get(...)`)
- Always pass a rich, data-specific prompt — never a bare `"Analyze this player"`
- Handle the final fallback explicitly; do not let the function return an empty body

### Prompt design
- System prompt: role + sport context + output format constraints
- User prompt: the actual data (stats, line, matchup) structured clearly
- Keep prompts focused — avoid dumping entire game logs when summary stats suffice
- Output format: if the frontend expects JSON structure, specify it in the prompt

---

## Secrets / Key Management

| Key | Required | Where it lives |
|-----|----------|---------------|
| `GROK_API_KEY` | **Yes — primary** | Supabase Edge Function secret |
| `GEMINI_API_KEY` | No — optional fallback | Supabase Edge Function secret |
| `OPENAI_API_KEY` | No — optional final fallback | Supabase Edge Function secret |

None of these keys may appear in: `src/`, Vite env vars (`VITE_*`), `.env` committed to Git, or any frontend-accessible location.

The app will function with only `GROK_API_KEY` set.
