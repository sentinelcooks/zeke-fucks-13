
## Plan: WaveSpeed.ai image generation for onboarding

### Architecture

WaveSpeed must be called from a Supabase **edge function** — not the client — because:
- Client-side `import.meta.env` would expose the API key in the JS bundle
- The user explicitly said "do not hardcode the API key" and "only read from environment variable"
- Lovable Cloud secrets are only accessible to edge functions

The WaveSpeed Flux-dev endpoint is **async**: POST returns a prediction ID, then you poll a result URL until `status: "completed"`. The edge function will handle this polling server-side and return the final URL to the client in one round trip.

### Files

**1. New secret: `WAVESPEED_API_KEY`** — added via `add_secret` tool (user provides value).

**2. New edge function: `supabase/functions/generate-image/index.ts`**
- Public (no JWT — onboarding is pre-auth). Add `verify_jwt = false` block to `supabase/config.toml`.
- Body: `{ prompt: string }`.
- POST to `https://api.wavespeed.ai/api/v3/wavespeed-ai/flux-dev` with `Authorization: Bearer ${WAVESPEED_API_KEY}` and `{ inputs: { prompt } }`.
- Poll the returned result URL (1s interval, 30s cap) until `status === "completed"`, return `{ imageUrl }`.
- On any failure → return `{ imageUrl: null, error }` with 200 so client can fallback gracefully.

**3. New client utility: `src/utils/generateImage.ts`**
```ts
export async function generateImage(prompt: string): Promise<string | null>
```
Wraps `supabase.functions.invoke("generate-image", { body: { prompt }})`. Returns `null` on failure.

**4. New hook: `src/hooks/useGeneratedImage.ts`**
- `useGeneratedImage(prompt, cacheKey)` → `{ url, loading, error }`.
- Caches in a module-level `Map<cacheKey, url>` so re-renders / step re-visits don't re-fetch.
- Also persists to `sessionStorage` keyed by `cacheKey` so back/forward navigation reuses the image.

**5. Update `src/pages/OnboardingPage.tsx`**
Replace static visuals on the 6 screens with WaveSpeed-generated hero images. Each gets a sport-aware Sentinel-aesthetic prompt:

| Screen | Cache key | Prompt |
|---|---|---|
| Welcome | `onboarding-welcome` | "Cinematic dark stadium at night, glowing purple data overlays and neon analytics graphs floating above the field, predator-hunter mood, ultra-detailed, 4k, moody lighting, Sentinel brand aesthetic" |
| The Edge | `onboarding-edge` | "Split-screen visualization: chaotic red losing chart on left vs glowing green ascending profit graph on right, dark cinematic background, holographic data, sharp focus" |
| Odds Format | `onboarding-odds` | "Glowing dice and floating odds numbers (-110, +150, 1.91) suspended in dark space, electric purple highlights, premium fintech aesthetic" |
| Sports | `onboarding-sports` | "Dark collage of NBA basketball, MLB baseball, NHL hockey, UFC octagon — silhouetted athletes mid-action with purple and cyan rim lighting, predator vibe" |
| Experience | `onboarding-experience` | "Lone hooded figure analyzing massive holographic data wall of sports analytics, dark room, purple glow, intense focus" |
| Value Proof | `onboarding-valueproof` | "Glowing premium player card hovering above dark surface, surrounded by floating heatmaps and shot charts, mint green confidence indicator" |

Rendering pattern per screen:
- Hero slot at top of each screen (rounded-2xl, ~aspect-video).
- While `loading` → `<Skeleton>` with subtle pulse + dark gradient placeholder.
- When `url` arrives → `<img>` with `framer-motion` fade-in (`initial={{ opacity: 0 }} animate={{ opacity: 1 }}`).
- If `url === null` (error) → solid `bg-gradient-to-br from-purple-900/40 via-black to-cyan-900/30` fallback so the screen never looks broken.
- Preload Welcome + Edge images on mount; lazy-trigger subsequent screen prompts when user reaches step `n - 1` (so Screen 3's image starts generating while user reads Screen 2).

### Tech notes
- The placeholder Jokić ESPN headshot in the Value Proof card stays (it's a real player headshot, not a hero visual). Only the hero/banner imagery is swapped to WaveSpeed.
- No DB changes. No auth changes.
- Cost control: cache hits short-circuit network calls; sessionStorage prevents re-gen across step navigation.

### Verification
1. Open `/onboarding` → Welcome screen shows skeleton ~2-5s, then fades into a WaveSpeed image.
2. Tap through to step 2 → cached image for Edge screen loads instantly (preloaded).
3. Network tab: only one `generate-image` invoke per unique prompt.
4. Force the edge function to fail (temporarily break the prompt key) → screen shows the dark gradient fallback, no crash.
5. Reload mid-flow → sessionStorage keeps the already-generated images so no re-spend.

### Out of scope
- Backfilling other surfaces (paywall, dashboard) with WaveSpeed images.
- Persisting generated URLs to Supabase storage (the WaveSpeed result URLs are already CDN-hosted and remain valid).

### Required from user
This plan needs the `WAVESPEED_API_KEY` value — once approved, I'll request it via the secrets tool before deploying the edge function.
