# Sentinel

> AI-powered sports data and edge-detection platform for informed sports analysis across NBA, MLB, NHL, and UFC.

Sentinel is **not a sportsbook**. It is an informational analytics tool that surfaces statistical edges, projections, and confidence-graded "Picks" / "Plays" — never "bets" — so users can make better-informed decisions.

---

## Table of Contents

1. [App Purpose](#app-purpose)
2. [Core Features](#core-features)
3. [Tech Stack](#tech-stack)
4. [Model Logic](#model-logic)
5. [Data Sources](#data-sources)
6. [Current Issues & Limitations](#current-issues--limitations)
7. [Roadmap](#roadmap)
8. [Development](#development)

---

## App Purpose

Sentinel exists to give recreational and serious sports analysts a **single source of truth** for:

- **Daily Picks** — the highest-confidence player props and game lines surfaced from a 20-factor weighted analysis engine, refreshed every morning.
- **Free Props** — high-volume daily plays (≥65% confidence) refreshed via an 8 AM ET cron.
- **Live Analysis** — on-demand player and moneyline analyzers with EV/Edge math, narrative reasoning, and a verdict badge.
- **Slip Builder** — a parlay constructor that grades each leg and the combined slip with a confidence score.
- **Profit Tracker** — manual P&L tracking with trend charts, win-rate zones, and daily bar visualizations.
- **Trends** — surface streaks, hot/cold players, and matchup-driven edges, with real-time NBA injury filtering.
- **Arbitrage** — both a manual calculator and a live scanner (True Arb / Low Vig) across 13 supported sportsbooks.

The product is **mobile-first** (320px–430px viewports), with a Vision-UI dark aesthetic, DM Sans typography, and a persistent 5-tab bottom navigation bar.

---

## Core Features

| Tab | Purpose |
|---|---|
| **Home** | Greeting, "Today's Edge" carousel, Yesterday's Results, Quick Access tiles |
| **Analyze** | Search-driven analyzer for player props and moneylines with animated verdict badge |
| **Slip** | Parlay builder with per-leg grading and overall slip confidence |
| **Profit** | Manual P&L tracker, trend charts, daily bar chart |
| **Settings** | Subscription, odds format, notifications, account |

Supplemental routes: `Free Props`, `Games`, `Trends`, `Arbitrage`, `Admin` (gated).

---

## Tech Stack

- **Frontend**: React 18, Vite 5, TypeScript 5, Tailwind CSS v3, shadcn/ui
- **Backend**: Lovable Cloud (Supabase Auth, Postgres + RLS, Edge Functions in Deno)
- **Subscriptions**: RevenueCat (entitlement verification via edge function)
- **AI**: Lovable AI Gateway (Gemini 2.5 / GPT-5 family) for narrative analysis and personalization
- **Data**: The Odds API (multi-key rotation), ESPN public API, Firecrawl
- **Mobile shell**: Capacitor (iOS/Android wrapping)

---

## Model Logic

### 1. The 20-Factor Weighted Engine

Every player-prop and moneyline analysis flows through a **sport-aware scoring engine** that evaluates up to 20 quantitative factors. Each factor produces a normalized 0–100 score, multiplied by a weight tuned per sport and bet type.

Factor categories:

- **Recent form** — last 5 / 10 / season averages, recency-weighted
- **Matchup difficulty** — opponent defensive rating vs. position (NBA), opposing pitcher xFIP / handedness splits (MLB), goalie save % and recent form (NHL)
- **Pace & game environment** — projected possessions, total line, park factors, weather (where relevant)
- **Usage & role** — minutes projection, snap share, line role (NHL), batting order
- **Health & lineup** — injury reports (ESPN, real-time), confirmed lineups, rest days
- **Historical vs. opponent** — career splits against the specific team
- **Line-shopping signal** — distance from market consensus, sharp money proxies
- **Variance & sample size** — penalizes high-variance or small-sample plays

Output: a **confidence score (0–100)** and a **verdict tier**:

| Tier | Range | Color |
|---|---|---|
| Strong | ≥ 75% | Green `#22c55e` |
| Lean | 65–74% | Amber |
| Marginal | 55–64% | Slate |
| Pass | < 55% | Red |

### 2. EV & Edge Engine

A unified engine computes **Expected Value** and **Edge** consistently across every market (player props, moneyline, spread, total):

```
implied_prob = american_to_implied(odds)
fair_prob    = model_confidence / 100
edge_pct     = (fair_prob - implied_prob) * 100
ev_per_unit  = (fair_prob * payout) - ((1 - fair_prob) * stake)
```

The same math powers Daily Picks, Free Props, Trends, and Analyze so numbers never disagree across screens.

### 3. Sport-Specific Notes

- **NBA** — Trends and SGP generation **automatically filter out players listed Out / Doubtful / Questionable** via real-time ESPN injury data. NBA correlation engine adjusts joint probabilities for legs from the same game.
- **MLB** — Sport-aware moneyline + props with ESPN stats mapping; pitcher/batter handedness splits are first-class factors.
- **NHL** — Uses sport-specific thresholds (lower scoring, higher variance); factors include goalie matchup, line deployment, and special-teams units.
- **UFC** — Head-to-head fighter comparison UI with ESPN athlete data; props analyzer covers method-of-victory and round totals.

### 4. Daily Picks Generation

- Cron-driven generation across NBA, MLB, NHL each morning.
- **Hard floor: 70% confidence** — anything below is discarded so the daily list stays high-signal.
- Each pick deep-links into the Analyze tab with prefilled context for one-tap deeper investigation.
- Yesterday's results auto-refresh every 60 seconds and apply finalization validation (no provisional grades shown).

### 5. AI-Generated Narrative

Narrative reasoning is bound by a strict **3-section, 2-sentences-max** template focused on per-game averages — no fluff, no padding, no hedging adjectives. Skim-friendly on mobile.

### 6. Personalization

Onboarding answers (sports, betting style, referral source) feed an AI personalization pass that tailors:

- Default Home tab feed ordering
- Daily tip seed (one rotating tip per user, generated at 8 AM ET)
- Onboarding paywall preview cards

---

## Data Sources

| Source | Purpose | Notes |
|---|---|---|
| **ESPN** | Schedules, scores, rosters, injuries, athlete photos | Primary source of truth |
| **The Odds API** | Live odds across 13 sportsbooks | Multi-key rotation w/ auto-failover |
| **Firecrawl** | Targeted web scraping for edge cases | Fallback only |
| **RevenueCat** | Subscription entitlements | Verified server-side via edge function |

**Supported sportsbooks (13):** FanDuel, DraftKings, BetMGM, Caesars, BetRivers, PointsBet, WynnBET, Unibet, Barstool, SuperBook, Fliff, PrizePicks, Underdog — queried across `us`, `us2`, `us_dfs`, `us_ex` regions.

> **API constraint**: Game-level markets (H2H / Spread / Total) **must** use `us` / `us2` regions only — other regions return 422 errors.

---

## Current Issues & Limitations

This section is intentionally honest. Sentinel is under active iteration; below are the known gaps as of this commit.

### Accuracy

1. **Confidence calibration drift over a season** — the 20-factor weights are tuned manually per sport. Late-season role changes (trades, tanking, load management) can leave a factor over- or under-weighted until the next manual tune. There is **no closed-loop retraining yet** — outcomes are logged in `prediction_snapshots` + `outcomes` tables but not fed back into weight optimization.
2. **Sample-size traps in early season** — first ~2 weeks of any season produce noisy "recent form" inputs because the model still leans on prior-season priors with limited weight. Treat early-season confidence as soft.
3. **NBA injury timing** — ESPN injury feeds update on a polling interval, not push. A late scratch (≤30 min before tip) may not be reflected, causing a stale projection. Mitigated but not eliminated by the real-time filter.
4. **Lineup confirmation gaps** — `lineup_confirmed` is tracked in snapshots but not always populated for non-NBA sports; props may be analyzed against a projected lineup that diverges from the actual one.

### Edge Cases

5. **Same-game parlay correlation** — NBA-only correlation engine. MLB/NHL/UFC SGPs treat legs as independent, which **overestimates** combined probability for correlated legs (e.g., a starter going Over Ks AND his team winning).
6. **UFC short-notice replacements** — when a fighter is replaced inside fight week, the analysis may still reference the original opponent's tape. Manual re-analysis required.
7. **Postponed / rescheduled games** — picks generated for a postponed game don't auto-void; they show as `pending` indefinitely until manually graded.
8. **Odds API rate-limit edge** — during a key rotation event, a request may briefly return stale cached odds (5-minute in-memory cache). Not visible to end users but can cause a tiny EV mismatch between Analyze and Free Props for ~1 refresh cycle.
9. **Arbitrage scanner false positives** — a small subset of "True Arb" results are stale by the time the user clicks through, especially around major news events. The scanner does not re-validate at click time.
10. **Profit Tracker manual entry** — there is no sportsbook account integration; all P&L is user-entered, so totals depend on user diligence.

### Product / UX

11. **No closed-loop learning UI** — users cannot yet flag "this pick was wrong because of X" in a structured way that feeds the model.
12. **Limited sport coverage** — no NFL, NCAA, soccer, tennis, or PGA. NFL is the most-requested gap.
13. **No push notifications for line moves** — push subscriptions are stored, but the only active notification is the daily tip.
14. **Admin-only edge-history visibility** — the model's per-pick factor breakdown lives in `nhl_factor_log` (NHL only) and is not exposed to end users for any sport.
15. **Android deep linking unverified** — Capacitor deep links for Daily Picks → Analyze handoff work on web and iOS; Android intent filters are unverified.

### Technical Debt

16. **Three legacy auth surfaces** — `LoginPage` (license-key flow), `AuthPage` (email + OAuth), and `WelcomeConfirmationPage` all coexist. The license-key flow predates Lovable Cloud auth and should eventually be retired.
17. **Mixed odds-format handling** — `useOddsFormat` hook covers most surfaces, but a few legacy components still hardcode American odds.
18. **Edge function cold starts** — first request after idle can take 1–2s; not CDN-cached.

---

## Roadmap

Short-list of what's next, roughly in priority order:

1. Closed-loop weight tuning from `outcomes` table (weekly batch).
2. NFL support (rosters, props, moneyline) ahead of next season.
3. SGP correlation for MLB and NHL.
4. User-facing factor breakdown ("why this pick") for all sports.
5. Push notifications for significant line moves on tracked plays.
6. Sportsbook account integrations to auto-populate Profit Tracker.
7. Retire legacy license-key auth flow.

---

## Development

```sh
npm install
npm run dev
```

Built on Lovable Cloud — backend (Auth, Postgres, Edge Functions, Storage) is provisioned automatically.

---

## Disclaimers

Sentinel provides **informational analysis only**. It is not a sportsbook, does not accept wagers, and does not guarantee outcomes. Sports wagering involves risk; users are solely responsible for any decisions made using this information. Where applicable, please bet responsibly and consult local laws.

---

*Last updated: 2026-04-21*
