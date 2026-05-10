// Per-sport scan: fetch events/props, prefilter, run analyzer validation,
// and write surviving candidates to daily_picks tiered as 'edge' (>=0.70)
// or 'daily' (otherwise). No '_pending' rows are written.
// Used by slate-scanner-{nba,mlb,nhl,ufc} so each sport runs in its own
// edge invocation (isolated wall-time budget).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  americanToImpliedProb,
  applyNbaAnalyzerBudget,
  calcEv,
  candidateDiagnostic,
  evaluateNbaEdgeGate,
  resolveNbaAnalyzerBudget,
  resolveNbaAnalyzerCap,
  scorePrecomputed,
  selectNbaAnalyzerPool,
  selectNbaAnalyzerPoolDiversified,
  type AnalyzerPoolRankInfo,
  type ScoredPlay,
} from "./edge_scoring.ts";
import { stripPropCodes } from "./format_labels.ts";
import { summarizeMarket } from "./odds_intelligence.ts";
import { normalizeDirection, normalizeNbaPropType } from "./prop_normalization.ts";
import {
  canonicalToScoredVerdict,
  normalizeCanonicalVerdict,
  normalizeConfidencePercent,
  scoredVerdictToCanonical,
} from "./canonical_verdict.ts";
import { buildDailyPickRow, applyAnalyzerFinalizeInsertGuard } from "./daily_pick_rows.ts";
import { enqueueGenericAnalyzerCandidates } from "./analyzer_queue.ts";

// App slate timezone — matches the public-display assumption in src/lib/gameDate.ts.
const APP_TZ = "America/New_York";

function toETDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  ufc: "mma_mixed_martial_arts",
};

// Per-sport analyzer-output confidence floor. MLB/NHL models naturally
// return lower confidence than NBA, so a single 0.65 gate dropped every
// MLB/NHL candidate. Tuned per sport.
const ANALYZER_MIN_CONF: Record<string, number> = {
  nba: 0.65,
  mlb: 0.45,
  nhl: 0.50,
  ufc: 0.50,
};

// Per-sport prefilter confidence floor (applied before the analyzer runs).
// Mirrors ANALYZER_MIN_CONF reasoning: MLB/NHL/UFC models score lower than
// NBA, so a uniform 0.62 gate filtered every non-NBA candidate to zero.
const PREFILTER_MIN_CONF: Record<string, number> = {
  nba: 0.62,
  mlb: 0.45,
  nhl: 0.50,
  ufc: 0.50,
};

// Sport → analyzer function path. nba-api/analyze is multi-sport: it dispatches
// internally to mlb-model/analyze and nhl-model/analyze for 20-factor team
// context. ANALYZER_LIMIT below caps per-sport concurrency so MLB/NHL traffic
// does not starve NBA. A null entry means "no analyzer endpoint exists" and
// such rows MUST NOT be inserted into Today's Edge / Picks (analyzer-required).
const ANALYZER_ENDPOINT: Record<string, string | null> = {
  nba: "nba-api/analyze",
  ufc: "ufc-api/analyze",
  mlb: "nba-api/analyze",
  nhl: "nba-api/analyze",
};

// Per-sport analyzer concurrency. Bounded to keep AI Gateway pressure low.
const ANALYZER_LIMIT: Record<string, number> = {
  nba: 3,
  mlb: 2,
  nhl: 2,
  ufc: 1,
};

const ANALYZER_TIMEOUT_MS = 12_000;
const DIAGNOSTIC_SAMPLE_LIMIT = 25;

// Per-sport edge cap (top-N by quality_score get tier='edge' inside this scan).
const EDGE_CAP_PER_SPORT: Record<string, number> = {
  nba: 5,
  mlb: 4,
  nhl: 3,
  ufc: 2,
};

type AnalyzerFailureType =
  | "timeout"
  | "rate_limited"
  | "http_4xx"
  | "http_5xx"
  | "empty_response"
  | "network"
  | "unknown";

export interface AnalyzerDiagnostics {
  endpoint: string | null;
  calls: number;
  skipped: number;
  rateLimited: number;
  retries: number;
  errors: number;
  callsAttempted: number;
  callsSucceeded: number;
  callsFailed: number;
  failureTypes: Record<AnalyzerFailureType, number>;
  budgetPerRun: number | null;
  budgetUsed: number;
  budgetDeferred: number;
  rateLimitStop: boolean;
  lastRetryAfterMs: number | null;
}

export function newAnalyzerDiagnostics(sport: string): AnalyzerDiagnostics {
  return {
    endpoint: ANALYZER_ENDPOINT[sport] ?? null,
    calls: 0,
    skipped: 0,
    rateLimited: 0,
    retries: 0,
    errors: 0,
    callsAttempted: 0,
    callsSucceeded: 0,
    callsFailed: 0,
    budgetPerRun: null,
    budgetUsed: 0,
    budgetDeferred: 0,
    rateLimitStop: false,
    lastRetryAfterMs: null,
    failureTypes: {
      timeout: 0,
      rate_limited: 0,
      http_4xx: 0,
      http_5xx: 0,
      empty_response: 0,
      network: 0,
      unknown: 0,
    },
  };
}

function classifyAnalyzerFailure(
  status: number,
  data: unknown,
  rateLimited: boolean,
): AnalyzerFailureType {
  if (rateLimited) return "rate_limited";
  if (status === 0) {
    const errStr = (() => {
      if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
        return String((data as Record<string, unknown>).error ?? "");
      }
      return typeof data === "string" ? data : "";
    })();
    if (errStr === "analyzer_timeout") return "timeout";
    if (errStr === "fetch_failed") return "network";
    return "network";
  }
  if (status >= 500 && status < 600) return "http_5xx";
  if (status >= 400 && status < 500) return "http_4xx";
  if (data == null || (typeof data === "string" && data.trim() === "")) {
    return "empty_response";
  }
  return "unknown";
}

interface TraceTarget {
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
}

interface TraceResult {
  requested: TraceTarget;
  odds_api_returned_prop: boolean;
  normalized_prop_type: string;
  normalized_direction: string;
  became_scanner_candidate: boolean;
  scanner_confidence: number | null;
  scanner_edge: number | null;
  lowConfidenceReason: Record<string, unknown> | null;
  missingDataFields: string[];
  hardSafetyReason: string[] | null;
  canonical_analyzer_called: boolean;
  analyzer_called: boolean;
  analyzer_payload: Record<string, unknown> | null;
  analyzer_http_status: number | null;
  analyzer_confidence: number | null;
  analyzer_verdict: string | null;
  analyzer_error: Record<string, unknown> | null;
  canonical_confidence: number | null;
  canonical_verdict: string | null;
  edge_gate_result: "passed" | "failed" | "not_evaluated" | null;
  edge_rejection_reasons: string[];
  edge_pool_rank: number | null;
  edge_pool_selected: boolean | null;
  analyzer_pool_bucket: string | null;
  analyzer_pool_rank: number | null;
  final_tier: string | null;
  final_rejection_reason: string | null;
}

interface ScanSportOptions {
  diagnosticsOnly?: boolean;
  traceTargets?: TraceTarget[];
}

export interface AnalyzerErrorCandidate {
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
  payload: Record<string, unknown>;
  status: number;
  error: unknown;
  errorType: AnalyzerFailureType;
  canonical_missing: boolean;
}

function getEnv(name: string): string | undefined {
  try {
    return typeof Deno !== "undefined" ? Deno.env.get(name) ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

function analyzerTimeoutMs(): number {
  const raw = Number(getEnv("ANALYZER_CALL_TIMEOUT_MS"));
  if (!Number.isFinite(raw) || raw <= 0) return ANALYZER_TIMEOUT_MS;
  return Math.max(3_000, Math.min(20_000, Math.round(raw)));
}

function normalizeTraceTargets(targets: TraceTarget[] | undefined): TraceResult[] {
  return (targets ?? []).map((t) => ({
    requested: {
      player_name: String(t.player_name ?? ""),
      prop_type: String(t.prop_type ?? ""),
      direction: String(t.direction ?? ""),
      line: Number(t.line),
    },
    odds_api_returned_prop: false,
    normalized_prop_type: normalizeNbaPropType(t.prop_type),
    normalized_direction: normalizeDirection(t.direction),
    became_scanner_candidate: false,
    scanner_confidence: null,
    scanner_edge: null,
    lowConfidenceReason: null,
    missingDataFields: [],
    hardSafetyReason: null,
    canonical_analyzer_called: false,
    analyzer_called: false,
    analyzer_payload: null,
    analyzer_http_status: null,
    analyzer_confidence: null,
    analyzer_verdict: null,
    analyzer_error: null,
    canonical_confidence: null,
    canonical_verdict: null,
    edge_gate_result: null,
    edge_rejection_reasons: [],
    edge_pool_rank: null,
    edge_pool_selected: null,
    analyzer_pool_bucket: null,
    analyzer_pool_rank: null,
    final_tier: null,
    final_rejection_reason: null,
  }));
}

function normName(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameLine(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.001;
}

function matchingTrace(traceResults: TraceResult[], playLike: {
  player_name?: string | null;
  prop_type?: string | null;
  direction?: string | null;
  line?: number | null;
}): TraceResult[] {
  const player = normName(playLike.player_name);
  const prop = normalizeNbaPropType(playLike.prop_type);
  const direction = normalizeDirection(playLike.direction);
  const line = Number(playLike.line);

  return traceResults.filter((tr) =>
    normName(tr.requested.player_name) === player &&
    tr.normalized_prop_type === prop &&
    tr.normalized_direction === direction &&
    sameLine(tr.requested.line, line)
  );
}

function missingFieldsForPlay(p: ScoredPlay): string[] {
  const missing: string[] = [];
  if (!p.player_name) missing.push("player_name");
  if (!p.prop_type) missing.push("prop_type");
  if (!p.direction) missing.push("direction");
  if (!Number.isFinite(p.line)) missing.push("line");
  if (!Number.isFinite(p.odds)) missing.push("odds");
  if (!p.game_date && !p.commence_time) missing.push("game_date");
  return missing;
}

function lowConfidenceDiagnostic(p: ScoredPlay, threshold: number): Record<string, unknown> {
  const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
  return {
    threshold,
    confidence: Math.round(p.confidence * 1000) / 1000,
    edge: Math.round(p.edge * 10000) / 10000,
    ev_pct: Math.round(p.ev_pct * 100) / 100,
    quality_score: Math.round(p.quality_score * 10000) / 10000,
    bookCount: md.bookCount ?? null,
    marketDataQuality: md.marketDataQuality ?? null,
    marketDepth: md.marketDepth ?? null,
    opponentResolutionStatus: md.opponentResolutionStatus ?? null,
  };
}

function canKeepLowConfidenceForNbaAnalyzer(p: ScoredPlay): boolean {
  if (p.sport !== "nba" || p.bet_type !== "prop") return false;
  const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
  const marketDataQuality = String(md.marketDataQuality ?? "").toLowerCase();
  const bookCount = Number(md.bookCount ?? NaN);
  const hasEnoughMarket =
    (Number.isFinite(bookCount) && bookCount >= 3) ||
    ["medium", "high"].includes(marketDataQuality);

  return (
    !!p.player_name &&
    !!p.prop_type &&
    !!p.direction &&
    Number.isFinite(p.line) &&
    Number.isFinite(p.odds) &&
    p.edge > 0 &&
    hasEnoughMarket &&
    marketDataQuality !== "unusable" &&
    marketDataQuality !== "very_low"
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export function parseRetryAfterMs(headerVal: string | null, dataAny: any): number | null {
  if (headerVal) {
    const n = Number(headerVal);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }
  if (dataAny && typeof dataAny === "object") {
    const ms = Number(dataAny.retryAfterMs ?? dataAny.retry_after_ms ?? NaN);
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms);
    const sec = Number(dataAny.retryAfter ?? dataAny.retry_after ?? NaN);
    if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
  }
  if (typeof dataAny === "string") {
    const m = dataAny.match(/retry after\s+(\d+)\s*ms/i);
    if (m) return Number(m[1]);
    const s = dataAny.match(/retry after\s+(\d+)\s*s/i);
    if (s) return Number(s[1]) * 1000;
  }
  return null;
}

function isRateLimited(r: FetchResult): boolean {
  if (r.status === 429) return true;
  if (typeof r.data === "string" && /rate.?limit/i.test(r.data)) return true;
  if (r.data && typeof r.data === "object") {
    const code = String(r.data.code ?? r.data.error ?? "").toLowerCase();
    if (code.includes("rate") && code.includes("limit")) return true;
  }
  return false;
}

// fnPost wrapper that detects 429 / RateLimitError and retries with backoff.
// Returns the final FetchResult and an extra rateLimited flag if all attempts failed.
async function fnPostWithRetry(
  path: string,
  body: any,
  diagnostics: AnalyzerDiagnostics,
  maxRetries = 2,
): Promise<FetchResult & { rateLimited?: boolean }> {
  let attempt = 0;
  let lastResult: FetchResult | null = null;

  while (attempt <= maxRetries) {
    const r = await fnPost(path, body);
    lastResult = r;

    if (!isRateLimited(r)) {
      return r;
    }

    if (attempt === maxRetries) {
      diagnostics.rateLimited++;
      return { ...r, rateLimited: true };
    }

    diagnostics.retries++;
    const waitMs =
      parseRetryAfterMs(null, r.data) ?? (1500 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 400);
    await new Promise((res) => setTimeout(res, waitMs + jitter));
    attempt++;
  }

  return { ...(lastResult as FetchResult), rateLimited: true };
}

// Sport-aware mapping from Odds-API market keys → analyzer prop_type.
// Must match cases in nba-api/index.ts getStatValue(). Unmapped → skip.
const NBA_MAP: Record<string, string> = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "3-pointers",
  player_blocks: "blocks",
  player_steals: "steals",
  player_turnovers: "turnovers",
  player_points_rebounds_assists: "pts+reb+ast",
  player_points_rebounds: "pts+reb",
  player_points_assists: "pts+ast",
  player_rebounds_assists: "reb+ast",
  player_blocks_steals: "stl+blk",
};

const MLB_MAP: Record<string, string> = {
  batter_hits: "hits",
  batter_runs_scored: "runs",
  batter_rbis: "rbi",
  batter_home_runs: "home_runs",
  batter_total_bases: "total_bases",
  batter_walks: "walks",
  batter_stolen_bases: "stolen_bases",
  batter_hits_runs_rbis: "h+r+rbi",
  pitcher_strikeouts: "strikeouts",
};

const NHL_MAP: Record<string, string> = {
  player_goals: "goals",
  player_points: "nhl_points",
  player_assists: "nhl_assists",
  player_shots_on_goal: "sog",
  player_total_saves: "saves",
};

function mapMarketToProp(sport: string, rawMarketKey: string): string | null {
  const key = rawMarketKey.replace(/_alternate$/, "");

  if (sport === "nba") return NBA_MAP[key] ? normalizeNbaPropType(NBA_MAP[key]) : null;
  if (sport === "mlb") return MLB_MAP[key] ?? null;
  if (sport === "nhl") return NHL_MAP[key] ?? null;

  return null;
}

interface FetchResult {
  ok: boolean;
  status: number;
  data: any;
  size: number;
}

// Decode the JWT payload (no signature verification — we only need the role
// claim to choose between platform-injected vs custom secret and to refuse
// to attempt an insert that will deterministically violate RLS).
type JwtAuthSource = "service_role" | "anon" | "user_jwt" | "missing";

function decodeJwtRole(jwt: string): JwtAuthSource {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return "missing";
    const pad = parts[1].length % 4;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/") + (pad ? "=".repeat(4 - pad) : "");
    const payload = JSON.parse(atob(b64));
    const role = typeof payload?.role === "string" ? payload.role : "";
    if (role === "service_role") return "service_role";
    if (role === "anon") return "anon";
    if (role === "authenticated") return "user_jwt";
    return "missing";
  } catch {
    return "missing";
  }
}

// Resolve the service-role JWT for daily_picks inserts. The Supabase CLI
// refuses `supabase secrets set SUPABASE_*` (reserved prefix), so we cannot
// rely on a user-managed SUPABASE_SERVICE_ROLE_KEY. Read user-controlled
// secrets first (SERVICE_ROLE_KEY, MASTER_SUPABASE_SERVICE_KEY) and pick the
// first JWT that actually decodes to role=service_role. SUPABASE_SERVICE_ROLE_KEY
// remains as a last-resort platform fallback for non-broken envs.
const SERVICE_ROLE_CANDIDATE_NAMES = [
  "SERVICE_ROLE_KEY",
  "MASTER_SUPABASE_SERVICE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

type ServiceRoleAuth = {
  key: string | null;
  sourceName: string;
  decodedRole: JwtAuthSource;
  presence: string[];
};

function resolveServiceRoleAuth(): ServiceRoleAuth {
  const presence: string[] = [];
  let firstSeenRole: JwtAuthSource = "missing";

  for (const name of SERVICE_ROLE_CANDIDATE_NAMES) {
    const value = Deno.env.get(name)?.trim();
    if (!value) continue;
    presence.push(name);
    const role = decodeJwtRole(value);
    if (firstSeenRole === "missing") firstSeenRole = role;
    if (role === "service_role") {
      return { key: value, sourceName: name, decodedRole: role, presence };
    }
  }

  return { key: null, sourceName: "none", decodedRole: firstSeenRole, presence };
}

// Read credentials at call-time so the values are always freshly resolved
// from the Deno isolate's environment.
function getInternalHeaders(): {
  Authorization: string;
  apikey: string;
  "Content-Type": string;
} | null {
  const key = Deno.env.get("SERVICE_ROLE_KEY")?.trim();

  if (!key) {
    console.error("sport_scan: SERVICE_ROLE_KEY is missing");
    return null;
  }

  if (!key.startsWith("eyJ")) {
    console.error("sport_scan: SERVICE_ROLE_KEY is not a valid JWT. Check Supabase secrets.");
    return null;
  }

  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
  };
}

// Always build internal function URLs as:
// https://PROJECT_REF.supabase.co/functions/v1/PATH
function getFnBase(): string {
  const rawUrl = Deno.env.get("PROJECT_URL")?.trim();

  if (!rawUrl) {
    throw new Error("sport_scan: PROJECT_URL is missing");
  }

  let cleanUrl = rawUrl.replace(/\/+$/, "");

  // If someone accidentally saved PROJECT_URL with /functions/v1 attached,
  // strip it so we do not create broken URLs.
  cleanUrl = cleanUrl.replace(/\/functions\/v1$/i, "");

  if (!cleanUrl.startsWith("https://")) {
    throw new Error(`sport_scan: PROJECT_URL is invalid: ${cleanUrl}`);
  }

  return `${cleanUrl}/functions/v1`;
}

function buildFnUrl(path: string): string {
  const base = getFnBase();
  const cleanPath = path.replace(/^\/+/, "");
  return `${base}/${cleanPath}`;
}

function safeLogUrl(url: string): string {
  return url.replace(/apikey=[^&]+/g, "apikey=REDACTED");
}

async function fnFetch(path: string): Promise<FetchResult> {
  const headers = getInternalHeaders();

  if (!headers) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing or invalid SERVICE_ROLE_KEY" },
      size: 0,
    };
  }

  const url = buildFnUrl(path);
  console.log(`fnFetch calling: ${safeLogUrl(url)}`);

  try {
    const r = await fetch(url, {
      method: "GET",
      headers,
    });

    const text = await r.text();
    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      ok: r.ok,
      status: r.status,
      data,
      size: text.length,
    };
  } catch (e) {
    console.error(`fnFetch ${path} threw:`, e);

    return {
      ok: false,
      status: 0,
      data: null,
      size: 0,
    };
  }
}

async function fnPost(path: string, body: any, timeoutMs = analyzerTimeoutMs()): Promise<FetchResult> {
  const headers = getInternalHeaders();

  if (!headers) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing or invalid SERVICE_ROLE_KEY" },
      size: 0,
    };
  }

  const url = buildFnUrl(path);
  console.log(`fnPost calling: ${safeLogUrl(url)}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await r.text();
    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      ok: r.ok,
      status: r.status,
      data,
      size: text.length,
    };
  } catch (e) {
    console.error(`fnPost ${path} threw:`, e);

    return {
      ok: false,
      status: 0,
      data: {
        error: e instanceof DOMException && e.name === "AbortError" ? "analyzer_timeout" : "fetch_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      size: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Roster name resolver (same as orchestrator pre-split) ──
const ESPN_SPORT_PATH: Record<string, { sport: string; league: string }> = {
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
};

const teamRosterCache = new Map<string, string[]>();

async function loadTeamRoster(sport: string, teamName: string): Promise<string[]> {
  if (!teamName) return [];

  const cacheKey = `${sport}|${teamName.toLowerCase()}`;

  if (teamRosterCache.has(cacheKey)) {
    return teamRosterCache.get(cacheKey)!;
  }

  const path = ESPN_SPORT_PATH[sport];

  if (!path) {
    teamRosterCache.set(cacheKey, []);
    return [];
  }

  try {
    const teamsRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/teams`
    );
    const teamsData = await teamsRes.json();
    const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
    const wanted = teamName.toLowerCase();

    const teamId = teams.find((t: any) =>
      t?.team?.displayName?.toLowerCase() === wanted ||
      t?.team?.name?.toLowerCase() === wanted ||
      t?.team?.location?.toLowerCase() === wanted ||
      `${t?.team?.location} ${t?.team?.name}`.toLowerCase() === wanted
    )?.team?.id;

    if (!teamId) {
      teamRosterCache.set(cacheKey, []);
      return [];
    }

    const rosterRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/teams/${teamId}/roster`
    );
    const rosterData = await rosterRes.json();
    const names: string[] = [];

    const collect = (arr: any[]) => {
      for (const a of arr || []) {
        if (a?.displayName) names.push(a.displayName);
        if (a?.fullName) names.push(a.fullName);
        if (Array.isArray(a?.items)) collect(a.items);
      }
    };

    collect(rosterData?.athletes || []);
    teamRosterCache.set(cacheKey, names);

    return names;
  } catch (e) {
    console.error(`roster fetch failed for ${sport} ${teamName}:`, e);
    teamRosterCache.set(cacheKey, []);

    return [];
  }
}

function resolveFullName(rawName: string, rosterPool: string[]): string {
  if (!rawName) return rawName;

  const lower = rawName.toLowerCase().trim();
  const exact = rosterPool.find((n) => n.toLowerCase() === lower);

  if (exact) return exact;

  const m = rawName.match(/^([A-Za-z])\.?\s+(.+)$/);

  if (m) {
    const [, initial, last] = m;

    const candidates = rosterPool.filter((n) => {
      const parts = n.split(/\s+/);

      return (
        parts[0]?.[0]?.toLowerCase() === initial.toLowerCase() &&
        parts[parts.length - 1]?.toLowerCase() === last.toLowerCase()
      );
    });

    if (candidates.length === 1) return candidates[0];
  }

  const tokens = rawName.split(/\s+/);
  const last = tokens[tokens.length - 1]?.toLowerCase();

  if (last && last.length > 2) {
    const candidates = rosterPool.filter((n) =>
      n.toLowerCase().endsWith(` ${last}`)
    );

    if (candidates.length === 1) return candidates[0];
  }

  return rawName;
}

// ── Game-line evaluation ──────────────
async function evaluateGameLines(sport: string, stats: any): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];

  if (!sportKey) return [];

  // UFC does not use games-schedule. The Odds API gives fight events directly.
  // Use h2h fight-winner odds as the free UFC picks source.
  if (sport === "ufc") {
    const oddsRes = await fnFetch(`nba-odds/events?sport=ufc&markets=h2h`);

    if (!oddsRes.ok) {
      console.error(
        `[ufc] nba-odds/events game-lines error (HTTP ${oddsRes.status}):`,
        JSON.stringify(oddsRes.data).slice(0, 300)
      );
    }

    const oddsEvents = Array.isArray(oddsRes.data?.events) ? oddsRes.data.events : [];
    const allUpcomingEvents = oddsEvents
      .filter((ev: any) => {
        if (!ev?.commence_time) return true;
        return new Date(ev.commence_time).getTime() > Date.now();
      })
      .sort((a: any, b: any) => {
        const at = a?.commence_time ? new Date(a.commence_time).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b?.commence_time ? new Date(b.commence_time).getTime() : Number.MAX_SAFE_INTEGER;
        return at - bt;
      });

    // Only scan the next UFC event/card. Odds API may return fights far into the future,
    // but Sentinel should only publish free UFC picks for the nearest upcoming card.
    const nextCardTime = allUpcomingEvents[0]?.commence_time || null;
    const upcomingEvents = nextCardTime
      ? allUpcomingEvents.filter((ev: any) => ev?.commence_time === nextCardTime)
      : allUpcomingEvents.slice(0, 1);

    stats.games = oddsEvents.length;
    stats.scheduled_games = allUpcomingEvents.length;
    stats.events = upcomingEvents.length;

    console.log(
      `[ufc] evaluateGameLines: ${upcomingEvents.length} fights from next UFC card ` +
      `(nextCardTime=${nextCardTime}, totalUpcoming=${allUpcomingEvents.length}, HTTP ${oddsRes.status})`
    );

    const candidateMap = new Map<string, ScoredPlay>();

    function addCandidate(play: ScoredPlay) {
      const key = [
        play.sport,
        play.bet_type,
        play.player_name,
        play.team ?? "",
        play.prop_type,
        play.direction,
        play.line,
        play.odds,
      ].join("|");

      const existing = candidateMap.get(key);

      if (!existing || play.confidence > existing.confidence || play.ev_pct > existing.ev_pct) {
        candidateMap.set(key, play);
      }
    }

    for (const ev of upcomingEvents) {
      const homeFighter = ev.home_team || "";
      const awayFighter = ev.away_team || "";
      const fightName = `${awayFighter} vs ${homeFighter}`;

      for (const bm of ev.bookmakers || []) {
        for (const mkt of bm.markets || []) {
          if (mkt.key !== "h2h") continue;

          for (const o of mkt.outcomes || []) {
            if (typeof o.price !== "number") continue;
            if (!o.name) continue;

            // Keep away from unreadable extreme odds.
            if (o.price >= 500 || o.price <= -350) continue;

            const implied = americanToImpliedProb(o.price);

            // Conservative market-derived projection. This uses real fight odds.
            // These non-prop plays skip nba-api/analyze, same as other moneyline plays.
            const projected = Math.max(0.38, Math.min(0.82, implied * 0.94 + 0.045));
            const edge = projected - implied;

            if (edge < 0.006) continue;

            const opponent =
              o.name === homeFighter ? awayFighter :
              o.name === awayFighter ? homeFighter :
              "";

            addCandidate(
              scorePrecomputed({
                sport,
                bet_type: "moneyline",
                player_name: fightName,
                home_team: homeFighter,
                away_team: awayFighter,
                team: o.name,
                opponent,
                prop_type: "moneyline",
                line: 0,
                direction: "win",
                odds: o.price,
                projected_prob: projected,
                implied_prob: implied,
                edge,
                ev_pct: calcEv(projected, o.price),
                confidence: projected,
                event_id: ev.id ?? null,
                commence_time: ev.commence_time ?? null,
                game_date: toETDate(ev.commence_time ?? null),
              })
            );
          }
        }
      }
    }

    const plays = Array.from(candidateMap.values()).sort((a, b) => {
      const scoreA = a.confidence * 100 + a.edge * 100 + a.ev_pct;
      const scoreB = b.confidence * 100 + b.edge * 100 + b.ev_pct;
      return scoreB - scoreA;
    });

    console.log(`[ufc] evaluateGameLines produced ${plays.length} fight-winner candidates`);

    return plays;
  }

  const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
  const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];

  stats.games = games.length;

  if (games.length === 0) {
    console.log(
      `[${sport}] evaluateGameLines: 0 games from games-schedule (status=${gamesRes.status})`
    );
    return [];
  }

  const upcoming = games.filter(
    (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
  );

  if (upcoming.length === 0) return [];

  const oddsRes = await fnFetch(
    `nba-odds/events?sport=${sport}&markets=h2h,spreads,totals`
  );

  if (!oddsRes.ok) {
    console.error(
      `[${sport}] nba-odds/events game-lines error (HTTP ${oddsRes.status}):`,
      JSON.stringify(oddsRes.data).slice(0, 300)
    );
  }

  const oddsEventsRaw = Array.isArray(oddsRes.data?.events) ? oddsRes.data.events : [];
  // Restrict to events whose actual game_date (America/New_York) is today.
  // Yesterday's already-played and tomorrow's events are dropped here so
  // they never appear in today's slate.
  const targetGameDate = todayET();
  const oddsEvents = oddsEventsRaw.filter(
    (ev: any) => ev?.commence_time && toETDate(ev.commence_time) === targetGameDate,
  );

  console.log(
    `[${sport}] evaluateGameLines: ${upcoming.length} upcoming games, ` +
      `${oddsEvents.length}/${oddsEventsRaw.length} Odds API events for ${targetGameDate} ` +
      `(HTTP ${oddsRes.status})`
  );

  const oddsMap = new Map<string, any>();

  for (const ev of oddsEvents) {
    const home = (ev.home_team || "").toLowerCase();
    const away = (ev.away_team || "").toLowerCase();

    oddsMap.set(`${home}|${away}`, ev);
    oddsMap.set(`${away}|${home}`, ev);
  }

  // MLB currently does not have reliable player props on the free/current Odds API setup.
  // This fallback creates conservative, market-based game-line candidates from h2h/spreads/totals.
  // Non-prop plays skip nba-api/analyze and can still populate Free Picks / Today's Edge.
  const gameLineMinEdge = sport === "mlb" ? 0.006 : 0.035;
  const gameLineBump = sport === "mlb" ? 0.045 : 0.03;
  const moneylineHomeBump = sport === "mlb" ? 0.05 : 0.04;
  const moneylineAwayBump = sport === "mlb" ? 0.04 : 0.02;

  const candidateMap = new Map<string, ScoredPlay>();

  function addCandidate(play: ScoredPlay) {
    const key = [
      play.sport,
      play.bet_type,
      play.player_name,
      play.team ?? "",
      play.prop_type,
      play.direction,
      play.line,
      play.odds,
    ].join("|");

    const existing = candidateMap.get(key);

    if (!existing || play.confidence > existing.confidence || play.ev_pct > existing.ev_pct) {
      candidateMap.set(key, play);
    }
  }

  for (const g of upcoming) {
    const key = `${(g.home_team || "").toLowerCase()}|${(g.away_team || "").toLowerCase()}`;
    const ev = oddsMap.get(key);

    if (!ev?.bookmakers?.length) continue;

    // Use all books, not only the first book. MLB free props are missing, so
    // this gives the game-line fallback enough candidates to work with.
    for (const bm of ev.bookmakers || []) {
      for (const mkt of bm.markets || []) {
        if (mkt.key === "h2h") {
          for (const o of mkt.outcomes || []) {
            if (typeof o.price !== "number") continue;

            const isHome = o.name === g.home_team;
            const implied = americanToImpliedProb(o.price);
            const projected = Math.max(
              0.35,
              Math.min(0.95, implied * 0.94 + (isHome ? moneylineHomeBump : moneylineAwayBump))
            );
            const edge = projected - implied;

            if (edge < gameLineMinEdge) continue;

            addCandidate(
              scorePrecomputed({
                sport,
                bet_type: "moneyline",
                player_name: `${g.away_team} @ ${g.home_team}`,
                home_team: g.home_team,
                away_team: g.away_team,
                team: o.name,
                opponent: isHome ? g.away_team : g.home_team,
                prop_type: "moneyline",
                line: 0,
                direction: isHome ? "home" : "away",
                odds: o.price,
                projected_prob: projected,
                implied_prob: implied,
                edge,
                ev_pct: calcEv(projected, o.price),
                confidence: projected,
                event_id: ev.id ?? null,
                commence_time: ev.commence_time ?? null,
                game_date: toETDate(ev.commence_time ?? null),
              })
            );
          }
        } else if (mkt.key === "spreads" || mkt.key === "totals") {
          const betType = mkt.key === "spreads" ? "spread" : "total";

          for (const o of mkt.outcomes || []) {
            if (typeof o.price !== "number") continue;

            const implied = americanToImpliedProb(o.price);
            const projected = Math.max(0.4, Math.min(0.92, implied * 0.94 + gameLineBump));
            const edge = projected - implied;

            if (edge < gameLineMinEdge) continue;

            const dir =
              betType === "total"
                ? (o.name || "").toLowerCase().includes("over")
                  ? "over"
                  : "under"
                : o.name === g.home_team
                  ? "home"
                  : "away";

            addCandidate(
              scorePrecomputed({
                sport,
                bet_type: betType as "spread" | "total",
                player_name: `${g.away_team} @ ${g.home_team}`,
                home_team: g.home_team,
                away_team: g.away_team,
                team: betType === "spread" ? o.name : null,
                opponent: null,
                prop_type: betType,
                line: o.point ?? 0,
                spread_line: betType === "spread" ? o.point : null,
                total_line: betType === "total" ? o.point : null,
                direction: dir,
                odds: o.price,
                projected_prob: projected,
                implied_prob: implied,
                edge,
                ev_pct: calcEv(projected, o.price),
                confidence: projected,
                event_id: ev.id ?? null,
                commence_time: ev.commence_time ?? null,
                game_date: toETDate(ev.commence_time ?? null),
              })
            );
          }
        }
      }
    }
  }

  const plays = Array.from(candidateMap.values()).sort((a, b) => {
    const scoreA = a.confidence * 100 + a.edge * 100 + a.ev_pct;
    const scoreB = b.confidence * 100 + b.edge * 100 + b.ev_pct;
    return scoreB - scoreA;
  });

  console.log(`[${sport}] evaluateGameLines produced ${plays.length} game-line candidates`);

  return plays;
}

// ── Player-prop evaluation ────────────
async function evaluatePlayerProps(
  sport: string,
  stats: any,
  traceResults: TraceResult[] = [],
): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];

  if (!sportKey && sport !== "ufc") return [];

  let events: any[] = [];

  const r = await fnFetch(`nba-odds/events?sport=${sport}&markets=h2h`);

  if (!r.ok) {
    console.error(
      `[${sport}] nba-odds/events props error (HTTP ${r.status}):`,
      JSON.stringify(r.data).slice(0, 300)
    );
  }

  const rawEvents = Array.isArray(r.data?.events) ? r.data.events : [];
  // Restrict prop events to today's actual game date (America/New_York).
  const targetGameDate = todayET();
  events = rawEvents.filter(
    (ev: any) => ev?.commence_time && toETDate(ev.commence_time) === targetGameDate,
  );

  console.log(
    `[${sport}] evaluatePlayerProps: ${events.length}/${rawEvents.length} Odds API events for ${targetGameDate} (HTTP ${r.status})`
  );

  // Drive scanning off the Games-tab schedule so EVERY scheduled game gets a chance.
  let upcoming: any[] = events;

  if (sportKey) {
    const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
    const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];

    const upcomingGames = games.filter(
      (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
    );

    stats.scheduled_games = upcomingGames.length;

    const eventByMatchup = new Map<string, any>();

    for (const ev of events) {
      const home = (ev.home_team || "").toLowerCase();
      const away = (ev.away_team || "").toLowerCase();

      eventByMatchup.set(`${home}|${away}`, ev);
      eventByMatchup.set(`${away}|${home}`, ev);
    }

    upcoming = upcomingGames
      .map((g: any) =>
        eventByMatchup.get(
          `${(g.home_team || "").toLowerCase()}|${(g.away_team || "").toLowerCase()}`
        )
      )
      .filter(Boolean);
  } else {
    stats.scheduled_games = events.length;
  }

  stats.events = upcoming.length;

  const plays: ScoredPlay[] = [];
  let propLineCount = 0;
  const playerSet = new Set<string>();

  // Per-sport fanout chunk size. MLB events are noisy and the player-props
  // endpoint has hit rate limits at chunk=5; 2 keeps us under the burst
  // threshold while preserving NBA/NHL throughput.
  const CHUNK = sport === "mlb" ? 2 : 5;
  const eventProps: Array<{ ev: any; data: any }> = [];

  for (let i = 0; i < upcoming.length; i += CHUNK) {
    const slice = upcoming.slice(i, i + CHUNK);

    const results = await Promise.all(
      slice.map((ev: any) =>
        fnFetch(`nba-odds/player-props?sport=${sport}&eventId=${ev.id}`).then((res) => ({
          ev,
          data: res.data,
        }))
      )
    );

    eventProps.push(...results);

    // If any chunk fetch surfaced a rate-limit hint, sleep before the next
    // chunk so we don't hammer the upstream provider into another 429.
    let chunkRetryAfterMs = 0;
    for (const r of results) {
      const retryHint = (r.data as { retryAfterMs?: number; retry_after_ms?: number } | null)
        ?.retryAfterMs ?? (r.data as { retry_after_ms?: number } | null)?.retry_after_ms ?? 0;
      if (retryHint > chunkRetryAfterMs) chunkRetryAfterMs = retryHint;
    }
    if (chunkRetryAfterMs > 0 && i + CHUNK < upcoming.length) {
      const sleepMs = Math.min(chunkRetryAfterMs, 5_000);
      console.warn(
        `[sport_scan] sport=${sport} player-props chunk rate-limited; sleeping ${sleepMs}ms before next chunk`,
      );
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  for (const { ev, data } of eventProps) {
    if (!ev?.id) continue;

    const players = data?.players || {};
    const homeTeam = ev.home_team || data?.home_team || null;
    const awayTeam = ev.away_team || data?.away_team || null;

    const [homeRoster, awayRoster] = await Promise.all([
      loadTeamRoster(sport, homeTeam),
      loadTeamRoster(sport, awayTeam),
    ]);

    const rosterPool = [...homeRoster, ...awayRoster];
    const homeRosterLc = new Set(homeRoster.map((n) => n.toLowerCase()));
    const awayRosterLc = new Set(awayRoster.map((n) => n.toLowerCase()));

    for (const [rawPlayerName, markets] of Object.entries(
      players as Record<string, any>
    )) {
      const playerName = rosterPool.length
        ? resolveFullName(rawPlayerName, rosterPool)
        : rawPlayerName;

      const playerNameLc = playerName.toLowerCase();
      const onHome = homeRosterLc.has(playerNameLc);
      const onAway = awayRosterLc.has(playerNameLc);
      let playerTeamRaw: string | null = null;
      let opponentRaw: string | null = null;
      let opponentResolutionStatus: "resolved" | "missing" | "ambiguous" = "missing";
      if (onHome && !onAway) {
        playerTeamRaw = homeTeam;
        opponentRaw = awayTeam;
        opponentResolutionStatus = playerTeamRaw && opponentRaw ? "resolved" : "missing";
      } else if (onAway && !onHome) {
        playerTeamRaw = awayTeam;
        opponentRaw = homeTeam;
        opponentResolutionStatus = playerTeamRaw && opponentRaw ? "resolved" : "missing";
      } else if (onHome && onAway) {
        opponentResolutionStatus = "ambiguous";
      }

      playerSet.add(playerName);

      for (const [rawMarketKey, outcomes] of Object.entries(
        markets as Record<string, any[]>
      )) {
        if (/_alternate$/.test(rawMarketKey)) continue;

        const marketKey = mapMarketToProp(sport, rawMarketKey);

        if (!marketKey) continue;

        const grouped = new Map<string, { side: string; line: number; bestPrice: number }>();
        const lineBookCount = new Map<number, number>();
        const lineJuiceSum = new Map<number, { sum: number; n: number }>();

        for (const o of outcomes as any[]) {
          const side = (o.name || "").toLowerCase().includes("under")
            ? "under"
            : "over";
          const line = Number(o.point ?? 0);
          for (const tr of matchingTrace(traceResults, {
            player_name: playerName,
            prop_type: marketKey,
            direction: side,
            line,
          })) {
            tr.odds_api_returned_prop = true;
            tr.normalized_prop_type = marketKey;
            tr.normalized_direction = side;
          }
          const k = `${side}|${line}`;
          const cur = grouped.get(k);

          if (!cur || o.price > cur.bestPrice) {
            grouped.set(k, { side, line, bestPrice: o.price });
          }

          lineBookCount.set(line, (lineBookCount.get(line) || 0) + 1);

          const j = lineJuiceSum.get(line) || { sum: 0, n: 0 };
          j.sum += Math.abs((o.price ?? -110) - -110);
          j.n += 1;
          lineJuiceSum.set(line, j);
        }

        if (lineBookCount.size === 0) continue;

        let standardLine: number | null = null;
        let bestCount = -1;
        let bestJuice = Infinity;

        for (const [ln, count] of lineBookCount.entries()) {
          const j = lineJuiceSum.get(ln)!;
          const avgJuice = j.sum / j.n;

          if (count > bestCount || (count === bestCount && avgJuice < bestJuice)) {
            standardLine = ln;
            bestCount = count;
            bestJuice = avgJuice;
          }
        }

        const minBookCount = sport === "mlb" ? 1 : 3;

        if (standardLine === null || bestCount < minBookCount) continue;

        const lines = new Set<number>([standardLine]);

        for (const line of lines) {
          const over = grouped.get(`over|${line}`);
          const under = grouped.get(`under|${line}`);

          for (const side of ["over", "under"] as const) {
            const pick = side === "over" ? over : under;

            if (!pick) continue;
            if (pick.bestPrice <= -350 || pick.bestPrice >= 400) continue;

            propLineCount++;

            const impliedSide = americanToImpliedProb(pick.bestPrice);
            const oppPick = side === "over" ? under : over;

            let projected: number;

            if (oppPick) {
              const impliedOpp = americanToImpliedProb(oppPick.bestPrice);
              const sum = impliedSide + impliedOpp;
              projected = sum > 0 ? impliedSide / sum : impliedSide;
            } else {
              projected = impliedSide;
            }

            const baseBump =
              pick.bestPrice < 0
                ? Math.min(0.10, 0.04 + (Math.abs(pick.bestPrice) - 100) / 2000)
                : Math.max(0.02, 0.04 - (pick.bestPrice - 100) / 4000);

            projected = Math.min(0.95, projected + baseBump);
            projected = Math.max(0.35, Math.min(0.95, projected));

            const edge = projected - impliedSide;

            if (edge <= 0.005) continue;

            const scored = scorePrecomputed({
              sport,
              bet_type: "prop",
              player_name: playerName,
              team: playerTeamRaw,
              opponent: opponentRaw,
              home_team: homeTeam,
              away_team: awayTeam,
              prop_type: marketKey,
              line,
              direction: side,
              odds: pick.bestPrice,
              projected_prob: projected,
              implied_prob: impliedSide,
              edge,
              ev_pct: calcEv(projected, pick.bestPrice),
              confidence: projected,
              event_id: ev.id ?? null,
              commence_time: ev.commence_time ?? null,
              game_date: toETDate(ev.commence_time ?? null),
            });
            for (const tr of matchingTrace(traceResults, scored)) {
              tr.became_scanner_candidate = true;
              tr.scanner_confidence = Math.round(scored.confidence * 1000) / 1000;
              tr.scanner_edge = Math.round(scored.edge * 10000) / 10000;
            }
            // Phase-1 diagnostics: market-side summary from outcomes already
            // fetched (no new API calls). Analyzer may merge ESPN-side
            // diagnostics on top of this in validateWithAnalyzer.
            try {
              const market = summarizeMarket({
                outcomes: outcomes as any[],
                standardLine,
                side,
                bestPrice: pick.bestPrice,
                oppBestPrice: oppPick?.bestPrice ?? null,
              });
              scored.model_diagnostics = {
                ...market,
                opponentResolutionStatus,
                eventHomeTeam: homeTeam ?? null,
                eventAwayTeam: awayTeam ?? null,
              };
            } catch (e) {
              console.error(`[${sport}] summarizeMarket failed:`, (e as Error).message);
            }
            plays.push(scored);
          }
        }
      }
    }
  }

  stats.players = playerSet.size;
  stats.propLines = propLineCount;
  stats.candidates = plays.length;

  if (sport === "ufc" && plays.length === 0 && stats.events > 0) {
    console.log(`[ufc] no prop markets supported; relying on h2h game lines`);
  }

  if (sport !== "ufc" && upcoming.length > 0 && playerSet.size === 0) {
    const sample = eventProps.slice(0, 3).map(({ ev, data }) => ({
      eventId: ev?.id,
      players: Object.keys(data?.players || {}).length,
      hasError: !!data?.error,
    }));
    console.log(
      `[${sport}] all ${upcoming.length} events returned 0 players from nba-odds/player-props. ` +
      `sample=${JSON.stringify(sample)}`
    );
  }

  return plays;
}

// ── Analyzer validation ──────────────
// Soft-fail policy:
// - No endpoint for this sport → return play unchanged (deterministic survives).
// - Rate-limited after retries → return play unchanged.
// - Hard verdict PASS/FADE or playerIsOut → return null.
// - Other errors → return play unchanged (do not crash the scan).
// transientDeferred (optional) — per-invocation array, NEVER module-scope.
// When provided, validateWithAnalyzer pushes the play onto it on retryable
// failures (rate_limited / analyzer_timeout / http_5xx / network) so the
// caller can enqueue them onto the generic analyzer_queue. Each entry pairs
// the play with the canonical analyzer body and the classification reason.
export interface TransientDeferredEntry {
  play: ScoredPlay;
  analyzer_body: Record<string, unknown>;
  reason: "rate_limited" | "analyzer_timeout" | "http_5xx" | "network";
  retry_after_ms?: number;
}

export async function validateWithAnalyzer(
  play: ScoredPlay,
  cache: Map<string, any>,
  diagnostics: AnalyzerDiagnostics,
  traceResults: TraceResult[] = [],
  analyzerErrorCandidates: AnalyzerErrorCandidate[] = [],
  transientDeferred?: TransientDeferredEntry[],
): Promise<ScoredPlay | null> {
  if (play.bet_type !== "prop") return play;

  // analyzer-finalize.v1: belt-and-suspenders guard — never analyze a prop with
  // line<=0. The scanner's market aggregation should already reject these but
  // verifying here means the saved row can never carry a fake line.
  if (play.bet_type === "prop" && (!Number.isFinite(play.line) || play.line <= 0)) {
    for (const tr of matchingTrace(traceResults, play)) {
      tr.final_rejection_reason = "prop_line_zero";
    }
    return null;
  }

  // phase-c.v1: capture scanner confidence before any analyzer modification
  const scannerConfidence = play.confidence;
  const scannerConfidencePercent = normalizeConfidencePercent(scannerConfidence);

  const endpoint = ANALYZER_ENDPOINT[play.sport] ?? null;
  if (!endpoint) {
    diagnostics.skipped++;
    // analyzer-finalize.v1: no analyzer endpoint — uniform contract so downstream
    // (See Why, savedPick) can read the same keys regardless of sport.
    const phaseCDiag: Record<string, unknown> = {
      scannerConfidence,
      scanner_confidence_raw: play.raw_confidence ?? scannerConfidence,
      scanner_confidence_percent: scannerConfidencePercent,
      analyzerConfidence: null,
      analyzer_confidence_percent: null,
      analyzer_payload: null,
      analyzer_response_snapshot: null,
      analyzer_confidence_raw: null,
      analyzer_verdict_raw: null,
      analyzer_called_at: null,
      confidenceSource: "scanner",
      verdictSource: "scanner",
      canonical_confidence: scannerConfidencePercent,
      canonical_verdict: scoredVerdictToCanonical(play.verdict),
      analyzerAgreement: "unavailable",
      analyzerDisagreementReason: null,
      publishedSource: "scanner",
      sourceContractVersion: "analyzer-finalize.v1",
    };
    return {
      ...play,
      model_diagnostics: { ...(play.model_diagnostics ?? {}), ...phaseCDiag },
    };
  }

  const cacheKey = `${play.sport}|${play.player_name}|${play.prop_type}|${play.line}|${play.direction}`;
  let analyzed = cache.get(cacheKey);

  // analyzer-finalize.v1: hoist body so cache-hit path can also persist the
  // exact analyzer request that was used for this play.
  const body = {
    player: play.player_name,
    prop_type: play.sport === "nba" ? normalizeNbaPropType(play.prop_type) : play.prop_type,
    line: play.line,
    over_under: normalizeDirection(play.direction),
    opponent: play.opponent || "",
    team: play.team || null,
    home_team: play.home_team || null,
    away_team: play.away_team || null,
    sport: play.sport,
    bet_type: "player_prop",
  };

  if (!analyzed) {
    diagnostics.calls++;
    diagnostics.callsAttempted++;
    for (const tr of matchingTrace(traceResults, play)) {
      tr.canonical_analyzer_called = true;
      tr.analyzer_called = true;
      tr.analyzer_payload = body;
    }
    const r = await fnPostWithRetry(endpoint, body, diagnostics);

    for (const tr of matchingTrace(traceResults, play)) {
      tr.analyzer_http_status = r.status;
    }

    if (r.rateLimited) {
      // Keep deterministic candidate alive instead of dropping it.
      diagnostics.callsFailed++;
      const ftype: AnalyzerFailureType = "rate_limited";
      diagnostics.failureTypes[ftype]++;
      const errorInfo: AnalyzerErrorCandidate = {
        player_name: play.player_name,
        prop_type: body.prop_type,
        direction: body.over_under,
        line: play.line,
        payload: body,
        status: r.status,
        error: r.data ?? "rate_limited",
        errorType: ftype,
        canonical_missing: true,
      };
      if (analyzerErrorCandidates.length < DIAGNOSTIC_SAMPLE_LIMIT) {
        analyzerErrorCandidates.push(errorInfo);
      }
      // Generic queue: capture for non-NBA sports so process-analyzer-queue
      // can retry once the rate-limit clears.
      if (transientDeferred) {
        const retryMs = parseRetryAfterMs(null, r.data) ?? 300_000;
        transientDeferred.push({ play, analyzer_body: body, reason: "rate_limited", retry_after_ms: retryMs });
      }
      for (const tr of matchingTrace(traceResults, play)) {
        tr.analyzer_error = {
          status: r.status,
          error: r.data ?? "rate_limited",
          errorType: ftype,
          canonical_missing: true,
        };
      }
      return play;
    }

    if (!r.ok || !r.data) {
      diagnostics.errors++;
      diagnostics.callsFailed++;
      const ftype = classifyAnalyzerFailure(r.status, r.data, false);
      diagnostics.failureTypes[ftype]++;
      const errorSnippet = (() => {
        try { return JSON.stringify(r.data).slice(0, 500); }
        catch { return String(r.data).slice(0, 500); }
      })();
      const errorInfo: AnalyzerErrorCandidate = {
        player_name: play.player_name,
        prop_type: body.prop_type,
        direction: body.over_under,
        line: play.line,
        payload: body,
        status: r.status,
        error: r.data ?? "empty_response",
        errorType: ftype,
        canonical_missing: true,
      };
      if (analyzerErrorCandidates.length < DIAGNOSTIC_SAMPLE_LIMIT) {
        analyzerErrorCandidates.push(errorInfo);
      }
      // Generic queue: capture retryable transient failures so the queue
      // processor can retry them. http_4xx is intentionally NOT retryable.
      if (
        transientDeferred &&
        (ftype === "timeout" || ftype === "http_5xx" || ftype === "network")
      ) {
        const reason: TransientDeferredEntry["reason"] =
          ftype === "timeout" ? "analyzer_timeout" : ftype === "http_5xx" ? "http_5xx" : "network";
        const retryMs = ftype === "timeout" ? 60_000 : 120_000;
        transientDeferred.push({ play, analyzer_body: body, reason, retry_after_ms: retryMs });
      }
      console.error(
        `[${play.sport}] analyzer error candidate: ${play.player_name} ${body.over_under} ${play.line} ${body.prop_type} ` +
        `status=${r.status} type=${ftype} payload=${JSON.stringify(body)} error=${errorSnippet}`
      );
      for (const tr of matchingTrace(traceResults, play)) {
        tr.analyzer_error = {
          status: r.status,
          error: r.data ?? "empty_response",
          errorType: ftype,
          canonical_missing: true,
        };
      }
      return play;
    }

    diagnostics.callsSucceeded++;
    analyzed = r.data;
    cache.set(cacheKey, analyzed);
  }

  if (analyzed.playerIsOut === true) {
    for (const tr of matchingTrace(traceResults, play)) tr.final_rejection_reason = "player_out";
    return null;
  }

  const conf = normalizeConfidencePercent(
    analyzed.canonical_confidence ?? analyzed.confidence ?? analyzed.displayConfidence ?? 0,
  );

  if (!conf || conf <= 0) {
    for (const tr of matchingTrace(traceResults, play)) {
      tr.canonical_confidence = null;
      tr.canonical_verdict = null;
      tr.final_rejection_reason = "analyzer_missing_confidence";
    }
    return null;
  }

  const canonicalVerdict = normalizeCanonicalVerdict(
    analyzed.canonical_verdict ?? analyzed.verdict ?? analyzed.decision?.verdict,
    conf,
  );
  for (const tr of matchingTrace(traceResults, play)) {
    tr.analyzer_confidence = Math.round(conf);
    tr.analyzer_verdict = canonicalVerdict;
    tr.canonical_confidence = Math.round(conf);
    tr.canonical_verdict = canonicalVerdict;
  }
  const verdict = canonicalVerdict;

  if (verdict === "PASS") {
    for (const tr of matchingTrace(traceResults, play)) tr.final_rejection_reason = "pass_verdict";
    return null;
  }

  const seasonAvg = Number(
    analyzed.seasonAvg ??
      analyzed.propAvg ??
      analyzed.avg ??
      analyzed.stats?.seasonAvg ??
      analyzed.stats?.avg ??
      NaN
  );

  if (Number.isFinite(seasonAvg) && seasonAvg === 0) {
    for (const tr of matchingTrace(traceResults, play)) tr.final_rejection_reason = "analyzer_zero_stat_average";
    return null;
  }

  const projected = Math.max(0, Math.min(1, conf / 100));
  const implied = play.implied_prob;
  const edge = projected - implied;

  if (edge <= 0.025) {
    for (const tr of matchingTrace(traceResults, play)) tr.final_rejection_reason = "canonical_edge_below_min";
    return null;
  }

  const minConf = ANALYZER_MIN_CONF[play.sport] ?? 0.55;

  if (projected < minConf) {
    for (const tr of matchingTrace(traceResults, play)) tr.final_rejection_reason = "canonical_confidence_below_min";
    return null;
  }

  const reasoningArr = Array.isArray(analyzed.reasoning) ? analyzed.reasoning : [];

  const reasoning = reasoningArr.length
    ? reasoningArr.slice(0, 3).join(" ")
    : play.reasoning;

  // Merge analyzer-emitted ESPN/playoff diagnostics on top of the market-side
  // summary that was already attached in evaluatePlayerProps.
  const analyzerDiag =
    analyzed && typeof analyzed.model_diagnostics === "object" && analyzed.model_diagnostics !== null
      ? (analyzed.model_diagnostics as Record<string, unknown>)
      : null;
  const mergedDiagnostics: Record<string, unknown> | null = analyzerDiag || play.model_diagnostics
    ? { ...(play.model_diagnostics ?? {}), ...(analyzerDiag ?? {}) }
    : null;

  // ── Phase 2: NBA playoff market-quality diagnostics ──
  // Activated only when NBA playoff overlay was already applied upstream
  // (playoffWeightsApplied=true). This is intentionally diagnostic/gating-only:
  // NBA saved confidence must remain the manual analyzer's canonical confidence.
  let adjustedProjected = projected;
  let adjustedEdge = edge;
  let marketQualityApplied = false;
  let marketQualityImpact: number | null = null;
  if (
    play.sport === "nba" &&
    play.bet_type === "prop" &&
    mergedDiagnostics &&
    mergedDiagnostics.playoffWeightsApplied === true
  ) {
    const md = mergedDiagnostics as Record<string, unknown>;
    const bookCount = typeof md.bookCount === "number" ? (md.bookCount as number) : null;
    const marketDepth = typeof md.marketDepth === "string" ? (md.marketDepth as string) : null;
    const marketDataQuality = typeof md.marketDataQuality === "string" ? (md.marketDataQuality as string) : null;
    if (marketDataQuality !== null) {
      let mImpact = 0;
      if (bookCount != null && bookCount >= 6 && marketDepth === "deep") mImpact += 1.5;
      if ((bookCount != null && bookCount <= 2) || marketDepth === "thin") mImpact -= 2;
      if (marketDataQuality === "low") mImpact -= 2;
      if (bookCount != null && bookCount < 3) mImpact = Math.min(mImpact, 0);
      mImpact = Math.max(-3, Math.min(3, mImpact));
      if (mImpact !== 0) {
        marketQualityApplied = true;
        marketQualityImpact = Math.round(mImpact * 10) / 10;
      }
      (mergedDiagnostics as Record<string, unknown>).marketQualityApplied = marketQualityApplied;
      (mergedDiagnostics as Record<string, unknown>).marketQualityImpact = marketQualityImpact;
    }
  }

  // analyzer-finalize.v1: symmetric agreement (lower OR higher beyond 10pts is drift)
  const analyzerConfidence = adjustedProjected;
  const diff = Math.abs(scannerConfidence - analyzerConfidence);
  const analyzerAgreement = diff <= 0.10 ? "agree" : "disagree";
  const analyzerDisagreementReason =
    analyzerAgreement === "disagree"
      ? `delta_${Math.round(diff * 100)}_${analyzerConfidence < scannerConfidence ? "lower" : "higher"}`
      : null;

  // analyzer-finalize.v1: build a minimal replayable response snapshot so See Why
  // can render the saved analyzer view without re-querying. Keep it small — the
  // full analyzed object can carry season-long stats arrays.
  const analyzerResponseSnapshot = {
    confidence: analyzed.canonical_confidence ?? analyzed.confidence ?? analyzed.displayConfidence ?? null,
    verdict: analyzed.canonical_verdict ?? analyzed.verdict ?? analyzed.decision?.verdict ?? null,
    reasoning: Array.isArray(analyzed.reasoning) ? analyzed.reasoning.slice(0, 8) : analyzed.reasoning ?? null,
    season_hit_rate: analyzed.season_hit_rate ?? null,
    last_5: analyzed.last_5 ?? null,
    last_10: analyzed.last_10 ?? null,
    head_to_head: analyzed.head_to_head ?? null,
    home_away: analyzed.home_away ?? null,
    diagnostics: analyzed.model_diagnostics ?? null,
  };

  const analyzerPayload = {
    player: body.player,
    prop_type: body.prop_type,
    line: body.line,
    over_under: body.over_under,
    opponent: body.opponent,
    sport: body.sport,
    team: body.team,
    home_team: body.home_team,
    away_team: body.away_team,
    bet_type: body.bet_type,
  };

  const phaseCDiag: Record<string, unknown> = {
    scannerConfidence,
    scanner_confidence_raw: play.raw_confidence ?? scannerConfidence,
    scanner_confidence_percent: scannerConfidencePercent,
    analyzerConfidence,
    analyzer_confidence_percent: Math.round(analyzerConfidence * 100),
    analyzer_payload: analyzerPayload,
    analyzer_response_snapshot: analyzerResponseSnapshot,
    analyzer_confidence_raw: typeof analyzed.confidence === "number" ? analyzed.confidence : null,
    analyzer_verdict_raw: analyzed.verdict ?? null,
    analyzer_called_at: new Date().toISOString(),
    confidenceSource: "analyzer",
    verdictSource: "analyzer",
    canonical_confidence: Math.round(analyzerConfidence * 100),
    canonical_verdict: canonicalVerdict,
    analyzerAgreement,
    analyzerDisagreementReason,
    publishedSource: "analyzer",
    sourceContractVersion: "analyzer-finalize.v1",
  };

  console.log(
    `[scanner][analyzer-finalize] player=${play.player_name} prop_type=${body.prop_type} line=${play.line} dir=${body.over_under} odds=${play.odds} analyzer_confidence=${Math.round(analyzerConfidence * 100)} scanner_confidence=${Math.round(scannerConfidencePercent)} agreement=${analyzerAgreement} payload=${JSON.stringify(analyzerPayload)}`,
  );

  return {
    ...play,
    projected_prob: adjustedProjected,
    edge: adjustedEdge,
    ev_pct: (() => {
      const o = play.odds;
      const decimal = o > 0 ? o / 100 + 1 : 100 / -o + 1;
      return (adjustedProjected * (decimal - 1) - (1 - adjustedProjected)) * 100;
    })(),
    confidence: adjustedProjected,
    verdict: canonicalToScoredVerdict(canonicalVerdict),
    reasoning,
    model_diagnostics: { ...(mergedDiagnostics ?? {}), ...phaseCDiag },
  };
}

// ── NBA Today's Edge hard eligibility gate ────────────────
// Applied only when sport='nba', before tier assignment. Returns ok=true if
// the pick is clean enough to be Today's Edge. All failures carry reasons so
// downstream code can route to daily/value or drop entirely.
const NBA_EDGE_GATE_VERSION = "2026-05-06.v2";

export interface NbaEdgeGateResult {
  ok: boolean;
  reasons: string[];
  hardSafetyFail: boolean;
  edge_gate_result: "passed" | "failed";
  edge_gate_decision: Record<string, unknown>;
  inputs: Record<string, unknown>;
  heavyJuiceThreshold: number;
  heavyJuiceAction: "penalty" | "downgrade" | "hard_block";
}

export function passNbaEdgeGate(p: ScoredPlay): NbaEdgeGateResult {
  return evaluateNbaEdgeGate(p);
}

export const NBA_EDGE_CAP = EDGE_CAP_PER_SPORT.nba ?? 5;
export { NBA_EDGE_GATE_VERSION };

// ── NBA analyzer resume queue ──
// Builds the canonical dedupe_key used by the nba_analyzer_queue partial
// unique constraint. Format mirrors the migration's documentation:
// '<pick_date>|<event_id_or_empty>|<player_name>|<prop_type>|<direction>|<line>'
export function buildNbaQueueDedupeKey(args: {
  pickDate: string;
  eventId: string | null | undefined;
  playerName: string;
  propType: string;
  direction: string;
  line: number;
}): string {
  return [
    args.pickDate,
    args.eventId ?? "",
    args.playerName,
    args.propType,
    args.direction,
    String(args.line),
  ]
    .map((s) => String(s).toLowerCase().trim())
    .join("|");
}

// Cap on how many rows a single scanner run may push into the queue.
// Prevents an unexpected odds shift from flooding the queue table.
const NBA_QUEUE_MAX_ENQUEUE_PER_RUN_DEFAULT = 60;

export async function enqueueNbaAnalyzerCandidates(
  supabase: ReturnType<typeof createClient>,
  pickDate: string,
  candidates: ScoredPlay[],
): Promise<{ enqueued: number; skipped: number }> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { enqueued: 0, skipped: 0 };
  }

  const cap = (() => {
    const raw = Number(getEnv("NBA_QUEUE_MAX_ENQUEUE_PER_RUN"));
    if (!Number.isFinite(raw) || raw <= 0) {
      return NBA_QUEUE_MAX_ENQUEUE_PER_RUN_DEFAULT;
    }
    return Math.max(1, Math.min(200, Math.round(raw)));
  })();

  const limited = candidates.slice(0, cap);
  const skipped = candidates.length - limited.length;

  const rows = limited.map((p) => {
    const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
    const skippedReason =
      typeof md.analyzer_skipped_reason === "string"
        ? (md.analyzer_skipped_reason as string)
        : "analyzer_call_budget_exceeded";
    const dedupeKey = buildNbaQueueDedupeKey({
      pickDate,
      eventId: p.event_id ?? null,
      playerName: p.player_name,
      propType: p.prop_type,
      direction: p.direction,
      line: p.line,
    });
    return {
      pick_date: pickDate,
      event_id: p.event_id ?? null,
      player_name: p.player_name,
      prop_type: p.prop_type,
      direction: p.direction,
      line: p.line,
      odds_snapshot: String(p.odds),
      dedupe_key: dedupeKey,
      status: "pending",
      attempts: 0,
      max_attempts: 3,
      next_run_after: new Date().toISOString(),
      retry_after_ms: null,
      skipped_reason: skippedReason,
      payload: p as unknown as Record<string, unknown>,
      diagnostics: null,
      game_date: p.game_date ?? null,
    };
  });

  // Defer to the SQL RPC so collisions with in-flight ('processing') rows
  // are handled in a real transaction (no clobbering of attempts /
  // next_run_after on a row a worker is actively analyzing).
  const { error } = await supabase.rpc("enqueue_nba_analyzer_candidates", {
    p_rows: rows,
  });

  if (error) {
    console.error("[nba] enqueue_nba_analyzer_candidates RPC error:", error);
    return { enqueued: 0, skipped };
  }

  return { enqueued: rows.length, skipped };
}


// ── Main per-sport entry ──────────────
export async function scanSport(sport: string, options: ScanSportOptions = {}): Promise<{
  sport: string;
  scanned: number;
  validated: number;
  inserted: number;
  stats: any;
  tiers?: { edge: number; daily: number; value: number; pass: number };
  analyzer?: AnalyzerDiagnostics;
  droppedNoGameDate?: number;
  diagnostics_only?: boolean;
  rejected?: Record<string, number>;
  rejected_low_confidence_top_25?: Array<Record<string, unknown>>;
  rejected_missing_data_top_25?: Array<Record<string, unknown>>;
  analyzer_error_candidates?: AnalyzerErrorCandidate[];
  target_trace_results?: TraceResult[];
  candidate_pool_size_before_analyzer?: number;
  candidate_pool_size_after_analyzer?: number;
  canonical_finalized_count?: number;
  edge_selected_count?: number;
  analyzer_pool_cap?: number;
  analyzer_pool_selected_count?: number;
  analyzer_calls_attempted?: number;
  analyzer_calls_succeeded?: number;
  analyzer_calls_failed?: number;
  analyzer_pool_truncated?: boolean;
  analyzer_pool_excluded_candidates?: Array<Record<string, unknown>>;
  error?: string;
}> {
  const traceResults = normalizeTraceTargets(options.traceTargets);
  const stats: any = {
    games: 0,
    scheduled_games: 0,
    events: 0,
    players: 0,
    propLines: 0,
    lines: 0,
    candidates: 0,
  };

  let lines: ScoredPlay[] = [];
  let props: ScoredPlay[] = [];

  try {
    lines = await evaluateGameLines(sport, stats);
    stats.lines = lines.length;

    props = await evaluatePlayerProps(sport, stats, traceResults);
  } catch (e) {
    console.error(`[${sport}] scan error:`, e);

    return {
      sport,
      scanned: 0,
      validated: 0,
      inserted: 0,
      stats,
      error: String(e),
    };
  }

  const all = [...lines, ...props];
  const scanned = all.length;

  const minConf = PREFILTER_MIN_CONF[sport] ?? 0.55;
  const drops = { conf: 0, oddsHigh: 0, oddsLow: 0, edge: 0 };
  const rejectedLowConfidenceTop: Array<Record<string, unknown>> = [];

  const prefiltered = all.filter((p) => {
    if (p.odds >= 500) { drops.oddsHigh++; return false; }
    if (p.odds <= -350) { drops.oddsLow++; return false; }
    if (p.edge <= 0) { drops.edge++; return false; }
    if (p.confidence < minConf) {
      const diag = lowConfidenceDiagnostic(p, minConf);
      for (const tr of matchingTrace(traceResults, p)) {
        tr.lowConfidenceReason = diag;
      }
      if (sport === "nba" && canKeepLowConfidenceForNbaAnalyzer(p)) {
        if (p.model_diagnostics) {
          (p.model_diagnostics as Record<string, unknown>).prefilterLowConfidenceOverride = true;
          (p.model_diagnostics as Record<string, unknown>).prefilterLowConfidenceReason = diag;
        }
        return true;
      }

      drops.conf++;
      if (rejectedLowConfidenceTop.length < DIAGNOSTIC_SAMPLE_LIMIT) {
        rejectedLowConfidenceTop.push({
          player_name: p.player_name,
          prop_type: p.prop_type,
          direction: p.direction,
          line: p.line,
          reason: "scanner_confidence_below_prefilter",
          ...diag,
        });
      }
      return false;
    }

    return true;
  });

  if (scanned > 0 && prefiltered.length === 0) {
    console.log(
      `[${sport}] prefilter dropped all ${scanned} candidates: ` +
      `conf<${minConf}=${drops.conf} odds>=+500=${drops.oddsHigh} ` +
      `odds<=-350=${drops.oddsLow} edge<=0=${drops.edge}`
    );
  }

  const analyzerPoolCap = sport === "nba"
    ? resolveNbaAnalyzerCap(getEnv("NBA_ANALYZER_CAP"))
    : 45;
  const analyzerPool = sport === "nba"
    ? selectNbaAnalyzerPoolDiversified(prefiltered, analyzerPoolCap)
    : (() => {
      const sorted = [...prefiltered].sort((a, b) => b.edge - a.edge);
      return {
        selected: sorted.slice(0, analyzerPoolCap),
        excluded: sorted
          .slice(analyzerPoolCap)
          .map((p) => candidateDiagnostic(p, "analyzer_pool_cap_exceeded")),
        truncated: sorted.length > analyzerPoolCap,
        ranks: undefined as Map<string, AnalyzerPoolRankInfo> | undefined,
      };
    })();
  const top = analyzerPool.selected;
  const cache = new Map<string, any>();
  const analyzerDiagnostics = newAnalyzerDiagnostics(sport);
  const analyzerErrorCandidates: AnalyzerErrorCandidate[] = [];
  // Per-invocation collection of retryable analyzer failures (rate-limit /
  // timeout / 5xx / network). Routed to enqueueGenericAnalyzerCandidates
  // for non-NBA sports at the persist phase. NEVER module-scope.
  const transientDeferred: TransientDeferredEntry[] = [];
  const analyzerPoolExcluded = analyzerPool.excluded;
  const analyzerPoolRanks: Map<string, AnalyzerPoolRankInfo> | undefined =
    "ranks" in analyzerPool ? analyzerPool.ranks : undefined;

  // Surface analyzer-pool rank into trace for selected candidates.
  if (analyzerPoolRanks) {
    for (const p of top) {
      const k = `${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;
      const info = analyzerPoolRanks.get(k);
      if (!info) continue;
      for (const tr of matchingTrace(traceResults, p)) {
        tr.analyzer_pool_bucket = info.bucket;
        tr.analyzer_pool_rank = info.rank;
      }
    }
  }

  for (const excluded of analyzerPoolExcluded) {
    for (const tr of matchingTrace(traceResults, excluded)) {
      tr.final_rejection_reason = excluded.exclusion_reason;
    }
  }

  if (analyzerDiagnostics.endpoint === null && top.length > 0) {
    console.warn(
      `[sport_scan] analyzer skipped for ${sport}: no sport-specific analyze endpoint`
    );
  }

  // ── Non-NBA queue-first persistence ──
  // MLB/NHL workers were OOMing (WORKER_RESOURCE_LIMIT) running the analyzer
  // mapLimit loop inline. For non-NBA sports we now persist the full ranked
  // analyzer pool to public.analyzer_queue BEFORE doing any heavy analyzer
  // work, then cap the inline analyzer budget so the worker can finish. The
  // queue cron drains the rest in the background.
  //
  // This block runs even on cold cache and even when the analyzer endpoint
  // is null — in the null case the queue rows record missing_analyzer_endpoint
  // for visibility but never publish.
  const INLINE_ANALYZER_BUDGET_NON_NBA: Record<string, number> = {
    mlb: 0,
    nhl: 0,
    ufc: 1,
  };
  // MLB/NHL are queue-only for now. Ignore env override so production
  // secrets cannot reintroduce inline analyzer calls.
  const HARD_CLAMP_INLINE_ZERO = new Set(["mlb", "nhl"]);
  let queueFirstInlineBudget = top.length;
  if (sport !== "nba") {
    if (HARD_CLAMP_INLINE_ZERO.has(sport)) {
      queueFirstInlineBudget = 0;
    } else {
      const envBudgetRaw = Number(getEnv(`INLINE_ANALYZER_BUDGET_${sport.toUpperCase()}`));
      queueFirstInlineBudget = Number.isFinite(envBudgetRaw) && envBudgetRaw >= 0
        ? Math.floor(envBudgetRaw)
        : INLINE_ANALYZER_BUDGET_NON_NBA[sport] ?? 0;
    }

    const endpoint = ANALYZER_ENDPOINT[sport];
    const queueFirstCandidates = top.slice(queueFirstInlineBudget);

    console.log(
      `[sport_scan] sport=${sport} queue_first=true ` +
        `candidates_ranked=${top.length} ` +
        `enqueue_attempted=${queueFirstCandidates.length} ` +
        `inline_analyzer_budget=${queueFirstInlineBudget}`,
    );

    if (queueFirstCandidates.length > 0) {
      try {
        const { key: qKey } = resolveServiceRoleAuth();
        const qUrl =
          getEnv("PROJECT_URL") ?? getEnv("SUPABASE_URL") ?? null;
        if (qKey && qUrl && endpoint) {
          const qClient = createClient(qUrl, qKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: {
              headers: {
                Authorization: `Bearer ${qKey}`,
                apikey: qKey,
              },
            },
          });
          const today_str = new Date().toISOString().slice(0, 10);
          const entries = queueFirstCandidates.map((p) => {
            const intendedTier =
              ((p.model_diagnostics ?? {}) as Record<string, unknown>).intended_tier as
                | string
                | undefined ?? null;
            const preGateTier =
              ((p.model_diagnostics ?? {}) as Record<string, unknown>).preGateTier as
                | string
                | undefined ?? null;
            const candidate_payload: Record<string, unknown> = {
              event_id: p.event_id ?? null,
              home_team: p.home_team ?? null,
              away_team: p.away_team ?? null,
              commence_time: p.commence_time ?? null,
              odds: p.odds,
              player_name: p.player_name ?? null,
              team: p.team ?? null,
              opponent: p.opponent ?? null,
              prop_type: p.prop_type,
              line: p.line,
              direction: p.direction,
              bet_type: p.bet_type,
              intended_tier: intendedTier,
              pre_gate_tier: preGateTier,
              pick_date: today_str,
              sport,
              model_diagnostics: p.model_diagnostics ?? null,
              raw_confidence: p.raw_confidence ?? null,
              ev_pct: p.ev_pct ?? null,
              edge: p.edge ?? null,
              spread_line: p.spread_line ?? null,
              total_line: p.total_line ?? null,
              reasoning: p.reasoning ?? null,
            };
            const analyzer_payload = {
              player: p.player_name,
              prop_type: p.prop_type,
              line: p.line,
              over_under: normalizeDirection(p.direction),
              opponent: p.opponent || "",
              team: p.team || null,
              home_team: p.home_team || null,
              away_team: p.away_team || null,
              sport,
              bet_type: "player_prop",
            };
            return {
              play: p,
              analyzerEndpoint: endpoint,
              analyzerPayload: analyzer_payload,
              candidatePayload: candidate_payload,
              intendedTier,
              preGateTier,
              scannerTraceId: null,
              classification: { reason: "budget_exceeded" as const, retry_after_ms: 60_000 },
            };
          });
          const res = await enqueueGenericAnalyzerCandidates(
            qClient,
            today_str,
            sport,
            entries,
          );
          console.log(
            `[analyzer-queue] sport=${sport} enqueue_attempted=${entries.length} ` +
              `enqueued=${res.enqueued} skipped=${res.refused} reason=queue_first`,
          );
          // Mark these as queue-deferred in trace + diagnostics so they're
          // excluded from the inline mapLimit loop below.
          for (const p of queueFirstCandidates) {
            const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
            md.analyzer_skipped_reason = "queue_first";
            p.model_diagnostics = md;
            for (const tr of matchingTrace(traceResults, p)) {
              tr.final_rejection_reason = "queue_first";
            }
          }
        } else {
          console.warn(
            `[analyzer-queue] sport=${sport} queue_first SKIPPED ` +
              `qKey=${qKey ? "ok" : "missing"} qUrl=${qUrl ? "ok" : "missing"} endpoint=${endpoint ?? "null"}`,
          );
        }
      } catch (qErr) {
        console.error(
          `[analyzer-queue] sport=${sport} queue_first enqueue failed:`,
          (qErr as Error)?.message ?? qErr,
        );
      }
    }
  }

  // ── Per-run analyzer call budget (NBA) ──
  // Pool stays at NBA_ANALYZER_CAP (default 80) to preserve diversity, but
  // only the top NBA_ANALYZER_BUDGET_PER_RUN of that pool actually call the
  // analyzer. Deferred candidates remain alive as deterministic picks but
  // are explicitly marked so they cannot be promoted to tier=edge.
  let runTargets: typeof top = top;
  let budgetDeferred: typeof top = [];
  if (sport !== "nba") {
    // Non-NBA: we already enqueued the bulk to analyzer_queue above. Inline
    // analyzer runs only the small queueFirstInlineBudget head of the pool
    // (default 0 for MLB/NHL). This keeps the worker under WORKER_RESOURCE_LIMIT.
    runTargets = top.slice(0, queueFirstInlineBudget);
    budgetDeferred = []; // already enqueued via queue-first path
    analyzerDiagnostics.budgetPerRun = queueFirstInlineBudget;
    analyzerDiagnostics.budgetUsed = runTargets.length;
    analyzerDiagnostics.budgetDeferred = top.length - runTargets.length;
  } else if (sport === "nba") {
    const budget = resolveNbaAnalyzerBudget(getEnv("NBA_ANALYZER_BUDGET_PER_RUN"));
    analyzerDiagnostics.budgetPerRun = budget;
    const enriched = top.map((p) => ({
      ...p,
      ev_pct: typeof p.ev_pct === "number" ? p.ev_pct : 0,
      is_trace_target: matchingTrace(traceResults, p).length > 0,
    }));
    const split = applyNbaAnalyzerBudget(enriched, budget);
    const selectedKeys = new Set(
      split.selected.map((p) => `${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`),
    );
    runTargets = top.filter((p) =>
      selectedKeys.has(`${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`),
    );
    budgetDeferred = top.filter(
      (p) => !selectedKeys.has(`${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`),
    );
    analyzerDiagnostics.budgetUsed = runTargets.length;
    analyzerDiagnostics.budgetDeferred = budgetDeferred.length;

    for (const p of budgetDeferred) {
      const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
      md.analyzer_skipped_reason = "analyzer_call_budget_exceeded";
      p.model_diagnostics = md;
      analyzerPoolExcluded.push(candidateDiagnostic(p, "analyzer_call_budget_exceeded"));
      for (const tr of matchingTrace(traceResults, p)) {
        tr.final_rejection_reason = "analyzer_call_budget_exceeded";
      }
    }
    if (budgetDeferred.length > 0) {
      console.log(
        `[${sport}] analyzer budget=${budget}; running ${runTargets.length}, deferring ${budgetDeferred.length}`,
      );
    }
  }

  const limit = ANALYZER_LIMIT[sport] ?? 1;
  let rateLimitTripped = false;
  const rateLimitDeferred: typeof top = [];
  const rawResults = await mapLimit(runTargets, limit, async (p) => {
    if (rateLimitTripped) {
      const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
      md.analyzer_skipped_reason = "analyzer_rate_limit_budget_exhausted";
      p.model_diagnostics = md;
      analyzerPoolExcluded.push(
        candidateDiagnostic(p, "analyzer_rate_limit_budget_exhausted"),
      );
      for (const tr of matchingTrace(traceResults, p)) {
        tr.final_rejection_reason = "analyzer_rate_limit_budget_exhausted";
      }
      if (sport === "nba") rateLimitDeferred.push(p);
      return p; // deterministic candidate stays alive; not edge-eligible
    }
    const beforeRateLimited = analyzerDiagnostics.failureTypes.rate_limited;
    try {
      const out = await validateWithAnalyzer(
        p, cache, analyzerDiagnostics, traceResults, analyzerErrorCandidates,
        sport === "nba" ? undefined : transientDeferred,
      );
      if (
        sport === "nba" &&
        analyzerDiagnostics.failureTypes.rate_limited > beforeRateLimited &&
        !rateLimitTripped
      ) {
        rateLimitTripped = true;
        analyzerDiagnostics.rateLimitStop = true;
        const lastErr = analyzerErrorCandidates[analyzerErrorCandidates.length - 1];
        const retryMs = lastErr ? parseRetryAfterMs(null, lastErr.error) : null;
        analyzerDiagnostics.lastRetryAfterMs = retryMs;
        console.warn(
          `[${sport}] analyzer rate-limited; stopping further calls this run (retry_after_ms=${retryMs ?? "?"})`,
        );
      }
      return out;
    } catch (e) {
      analyzerDiagnostics.errors++;
      analyzerDiagnostics.callsFailed++;
      const ftype: AnalyzerFailureType =
        e instanceof DOMException && e.name === "AbortError" ? "timeout" : "network";
      analyzerDiagnostics.failureTypes[ftype]++;
      if (analyzerErrorCandidates.length < DIAGNOSTIC_SAMPLE_LIMIT) {
        analyzerErrorCandidates.push({
          player_name: p.player_name,
          prop_type: p.prop_type,
          direction: p.direction,
          line: p.line,
          payload: {
            player: p.player_name,
            prop_type: p.prop_type,
            line: p.line,
            over_under: p.direction,
            sport: p.sport,
          },
          status: 0,
          error: e instanceof Error ? e.message : String(e),
          errorType: ftype,
          canonical_missing: true,
        });
      }
      for (const tr of matchingTrace(traceResults, p)) {
        tr.analyzer_called = true;
        tr.analyzer_error = {
          status: 0,
          error: e instanceof Error ? e.message : String(e),
          errorType: ftype,
          canonical_missing: true,
        };
      }
      console.error(`[${sport}] analyzer threw (${ftype}), keeping deterministic candidate:`, e);
      return p; // soft failure
    }
  });

  // Budget-deferred candidates were never analyzed but remain valid
  // deterministic plays. Append them so they can flow into daily/value tiers.
  for (const p of budgetDeferred) {
    rawResults.push(p);
  }

  const validated: ScoredPlay[] = [];
  for (const r of rawResults) {
    if (!r) continue;
    const rescored = scorePrecomputed({
      sport: r.sport,
      bet_type: r.bet_type,
      player_name: r.player_name,
      team: r.team ?? null,
      opponent: r.opponent ?? null,
      home_team: r.home_team ?? null,
      away_team: r.away_team ?? null,
      prop_type: r.prop_type,
      line: r.line,
      spread_line: r.spread_line ?? null,
      total_line: r.total_line ?? null,
      direction: r.direction,
      odds: r.odds,
      projected_prob: r.projected_prob,
      implied_prob: r.implied_prob,
      edge: r.edge,
      ev_pct: r.ev_pct,
      confidence: r.confidence,
      event_id: r.event_id ?? null,
      commence_time: r.commence_time ?? null,
      game_date: r.game_date ?? null,
    });

    rescored.reasoning = r.reasoning || rescored.reasoning;
    rescored.model_diagnostics = r.model_diagnostics ?? null;
    const canonicalVerdict = rescored.model_diagnostics?.canonical_verdict;
    if (canonicalVerdict === "STRONG" || canonicalVerdict === "LEAN" || canonicalVerdict === "RISKY" || canonicalVerdict === "PASS") {
      rescored.verdict = canonicalToScoredVerdict(canonicalVerdict);
    }
    validated.push(rescored);
  }

  // PASS picks are excluded from every public surface (no edge / daily / value).
  // Only non-PASS scored plays are eligible for tiering and insertion.
  const passPicks = validated.filter((p) => p.verdict === "Pass");
  const eligible = validated.filter((p) => p.verdict !== "Pass");

  const tierKey = (p: ScoredPlay) =>
    `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;

  // ── NBA edge gate: compute results once, cache by tierKey ──
  // For NBA picks, run hard eligibility gates before deciding which go to edge.
  // Non-NBA sports keep the original top-N-by-quality_score behavior unchanged.
  const nbaGateCache = new Map<string, NbaEdgeGateResult>();
  if (sport === "nba") {
    for (const p of eligible) {
      const gate = passNbaEdgeGate(p);
      nbaGateCache.set(tierKey(p), gate);
      for (const tr of matchingTrace(traceResults, p)) {
        tr.edge_gate_result = gate.ok ? "passed" : "failed";
        tr.edge_rejection_reasons = gate.reasons ?? [];
      }
    }
  }

  // Tier assignment over PASS-free set: top-N by quality_score → 'edge',
  // rest split into 'daily' (>=0.70 confidence) or 'value'. The public
  // Picks tab still gets daily/value rows, but only for non-PASS plays.
  const sortedByQuality = [...eligible].sort((a, b) => b.quality_score - a.quality_score);
  const edgeCap = EDGE_CAP_PER_SPORT[sport] ?? 5;
  const edgeKeySet = new Set<string>();
  const edgePoolDiagnostics = new Map<string, {
    rank: number | null;
    selected: boolean;
    selectionReason: string;
  }>();

  if (sport === "nba") {
    // Only gate-passing NBA picks are eligible for Today's Edge.
    // No fallback to ungated picks — fewer edge picks is acceptable.
    let nbaEdgeCount = 0;
    let gatePassRank = 0;
    for (const p of sortedByQuality) {
      const key = tierKey(p);
      const skipped = (p.model_diagnostics as Record<string, unknown> | null | undefined)
        ?.analyzer_skipped_reason;
      if (skipped === "analyzer_call_budget_exceeded" || skipped === "analyzer_rate_limit_budget_exhausted") {
        edgePoolDiagnostics.set(key, {
          rank: null,
          selected: false,
          selectionReason: String(skipped),
        });
        continue;
      }
      const gate = nbaGateCache.get(key);
      if (!gate?.ok) {
        edgePoolDiagnostics.set(key, {
          rank: null,
          selected: false,
          selectionReason: gate?.hardSafetyFail ? "hard_safety_later" : "failed_edge_gate",
        });
        continue;
      }

      gatePassRank++;
      if (nbaEdgeCount < edgeCap) {
        edgeKeySet.add(key);
        nbaEdgeCount++;
        edgePoolDiagnostics.set(key, {
          rank: gatePassRank,
          selected: true,
          selectionReason: "selected",
        });
      } else {
        edgePoolDiagnostics.set(key, {
          rank: gatePassRank,
          selected: false,
          selectionReason: edgeCap <= 0 ? "edge_slots_full" : "lower_rank_than_selected_picks",
        });
      }
    }
  } else {
    // phase-c.v1: agreement gate for sports without a dedicated analyzer (NHL, MLB).
    // Enabled via PHASE_C_GATE_ENABLED=true. Applies a stricter confidence floor
    // since we cannot confirm the scanner's market-derived confidence via an analyzer.
    const phaseCGateEnabled = Deno.env.get("PHASE_C_GATE_ENABLED") === "true";
    const strictFloor = Number(Deno.env.get("STRICT_EDGE_FLOOR_NO_ANALYZER") || "0.72");
    const hasAnalyzer = (ANALYZER_ENDPOINT[sport] ?? null) !== null;

    let sportEdgeCount = 0;
    for (const p of sortedByQuality) {
      if (sportEdgeCount >= edgeCap) break;
      if (phaseCGateEnabled && !hasAnalyzer && p.confidence < strictFloor) {
        // Mark fallback-gated in diagnostics so we can audit without affecting display
        if (p.model_diagnostics) {
          (p.model_diagnostics as Record<string, unknown>).phaseCGateBlocked = true;
          (p.model_diagnostics as Record<string, unknown>).phaseCGateReason = `confidence_${Math.round(p.confidence * 100)}_below_strict_floor_${Math.round(strictFloor * 100)}`;
        }
        continue;
      }
      edgeKeySet.add(tierKey(p));
      sportEdgeCount++;
    }

    // Fallback safety: if gate empties the edge slate for this sport, fall back to top-N
    // with a diagnostic flag. Better to show scanner-only picks than an empty slate.
    if (phaseCGateEnabled && edgeKeySet.size === 0 && sortedByQuality.length > 0) {
      for (const p of sortedByQuality.slice(0, edgeCap)) {
        edgeKeySet.add(tierKey(p));
        if (p.model_diagnostics) {
          (p.model_diagnostics as Record<string, unknown>).phaseCFallback = true;
          (p.model_diagnostics as Record<string, unknown>).sourceContractVersion = "phase-c.v1.fallback";
        }
      }
    }
  }

  const assignTier = (p: ScoredPlay): "edge" | "daily" | "value" | null => {
    if (edgeKeySet.has(tierKey(p))) {
      // phase-c.v1: if PHASE_C_GATE_ENABLED and analyzer materially disagrees, block edge
      const phaseCGateEnabled = Deno.env.get("PHASE_C_GATE_ENABLED") === "true";
      if (phaseCGateEnabled) {
        const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
        const agreement = md.analyzerAgreement as string | undefined;
        if (agreement === "disagree") {
          if (p.model_diagnostics) {
            (p.model_diagnostics as Record<string, unknown>).phaseCEdgeDemoted = true;
            (p.model_diagnostics as Record<string, unknown>).phaseCDemoteReason = md.analyzerDisagreementReason ?? "analyzer_disagree";
          }
          // Demote to daily rather than dropping — the play may still have value
          return p.confidence >= 0.70 ? "daily" : "value";
        }
      }
      return "edge";
    }
    if (sport === "nba") {
      const gate = nbaGateCache.get(tierKey(p));
      if (gate?.hardSafetyFail) return null; // drop from all public surfaces
    }
    if (p.confidence >= 0.70) return "daily";
    return "value";
  };

  const today = new Date().toISOString().slice(0, 10);

  let droppedNoGameDate = 0;
  let nbaHardSafetyDropped = 0;
  let nbaNonAnalyzerDropped = 0;
  // analyzer-finalize.v1 cross-sport: count rows blocked from edge/daily/value
  // because confidenceSource is not "analyzer" or analyzer side-car missing.
  const nonAnalyzerDroppedBySport: Record<string, number> = {};
  const rejectedMissingDataTop: Array<Record<string, unknown>> = [];
  // Defense-in-depth: if anything PASS leaks into `eligible`, drop it.
  let passVerdictBlocked = 0;
  const rows = eligible
    .map((p) => {
      if (p.verdict === "Pass") {
        passVerdictBlocked++;
        for (const tr of matchingTrace(traceResults, p)) {
          tr.final_rejection_reason = "pass_verdict";
        }
        return null;
      }
      const tier = assignTier(p);
      if (tier === null) {
        // NBA hard safety fail — drop from all public surfaces
        nbaHardSafetyDropped++;
        const gate = sport === "nba" ? nbaGateCache.get(tierKey(p)) : null;
        for (const tr of matchingTrace(traceResults, p)) {
          tr.hardSafetyReason = gate?.reasons ?? ["hard_safety"];
          tr.final_rejection_reason = "hard_safety";
        }
        return null;
      }
      // analyzer-finalize.v1: rows surfaced to users (edge/daily/value) MUST
      // carry analyzer-finalized confidence for ALL sports. Scanner-only
      // confidence is routed to the analyzer queue for later finalization,
      // never persisted as a live Pick. Applies to NBA, MLB, NHL, UFC, future.
      if (
        (tier === "edge" || tier === "daily" || tier === "value") &&
        ((p.model_diagnostics ?? {}) as Record<string, unknown>).confidenceSource !== "analyzer"
      ) {
        if (sport === "nba") nbaNonAnalyzerDropped++;
        nonAnalyzerDroppedBySport[sport] = (nonAnalyzerDroppedBySport[sport] ?? 0) + 1;
        for (const tr of matchingTrace(traceResults, p)) {
          tr.final_rejection_reason = "non_analyzer_source";
        }
        return null;
      }
      const gameDate = p.game_date ?? (p.commence_time ? toETDate(p.commence_time) : null);
      if (!gameDate) {
        droppedNoGameDate++;
        const missingFields = missingFieldsForPlay(p);
        if (rejectedMissingDataTop.length < DIAGNOSTIC_SAMPLE_LIMIT) {
          rejectedMissingDataTop.push({
            player_name: p.player_name,
            prop_type: p.prop_type,
            direction: p.direction,
            line: p.line,
            missing_fields: missingFields,
          });
        }
        for (const tr of matchingTrace(traceResults, p)) {
          tr.missingDataFields = missingFields;
          tr.final_rejection_reason = "missing_data";
        }
        return null;
      }
      const poolDiag = sport === "nba" ? edgePoolDiagnostics.get(tierKey(p)) : undefined;
      for (const tr of matchingTrace(traceResults, p)) {
        tr.final_tier = tier;
        tr.final_rejection_reason = null;
        if (poolDiag) {
          tr.edge_pool_rank = poolDiag.rank;
          tr.edge_pool_selected = poolDiag.selected;
        }
      }
      const verdictTag = p.verdict === "Strong" || p.verdict === "Lean"
        ? `[VERDICT:${p.verdict}] `
        : "";
      const cleanReasoning = stripPropCodes(p.reasoning ?? "");

      // Attach NBA gate diagnostics + EV fields to model_diagnostics
      let diagExtras: Record<string, unknown> = {};
      if (sport === "nba") {
        const key = tierKey(p);
        const gate = nbaGateCache.get(key);
        const pool = edgePoolDiagnostics.get(key);
        const preGateTier: "edge" | "daily" | "value" =
          sortedByQuality.indexOf(p) < edgeCap ? "edge"
          : p.confidence >= 0.70 ? "daily"
          : "value";
        const edgePoolSelectionReason =
          pool?.selected === true && tier !== "edge"
            ? "hard_safety_later"
            : pool?.selectionReason ?? (gate?.ok ? "not_ranked_for_edge_pool" : "failed_edge_gate");
        diagExtras = {
          edgeEligible: gate?.ok ?? true,
          edge_gate_result: gate?.edge_gate_result ?? "passed",
          edge_gate_inputs: gate?.inputs ?? null,
          edge_gate_decision: gate?.edge_gate_decision ?? null,
          edgeRejectionReasons: gate?.reasons ?? [],
          edgeDowngradeReason: gate && !gate.ok && gate.reasons.length > 0 ? gate.reasons[0] : null,
          nbaEdgeGateVersion: NBA_EDGE_GATE_VERSION,
          preGateTier,
          postGateTier: tier,
          edge_pool_rank: pool?.rank ?? null,
          edge_pool_selected: pool?.selected ?? false,
          edge_pool_selection_reason: edgePoolSelectionReason,
          heavy_juice_threshold: gate?.heavyJuiceThreshold ?? null,
          heavy_juice_action: gate?.heavyJuiceAction ?? "penalty",
          final_edge_eligible: tier === "edge",
          evPct: Math.round(p.ev_pct * 100) / 100,
          modelEdge: Math.round(p.edge * 10000) / 10000,
        };
      }

      const row = buildDailyPickRow({
        pickDate: today,
        play: {
          ...p,
          model_diagnostics: { ...(p.model_diagnostics ?? {}), ...diagExtras },
        },
        tier,
        raw: {
          event_id: p.event_id ?? null,
          commence_time: p.commence_time ?? null,
          game_date: gameDate,
          odds: String(p.odds),
        },
        sourceFunction: `slate-scanner-${sport}`,
        modelUsed: sport === "nba" ? "nba-api/analyze" : `${sport}-scanner`,
        reasoning: `${verdictTag}${cleanReasoning}`.trim(),
        avgValue: p.ev_pct,
      });
      return row;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const pickIdentityKey = (row: Record<string, unknown>) => [
    row.pick_date,
    row.sport,
    row.player_name ?? "",
    row.prop_type ?? "",
    row.direction ?? "",
    row.line ?? -9999,
  ].join("|");
  const rowIdentityCounts = new Map<string, number>();
  for (const row of rows) {
    const key = pickIdentityKey(row);
    rowIdentityCounts.set(key, (rowIdentityCounts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    const conflictCount = rowIdentityCounts.get(pickIdentityKey(row)) ?? 0;
    const diagnostics =
      row.model_diagnostics && typeof row.model_diagnostics === "object"
        ? row.model_diagnostics as Record<string, unknown>
        : {};
    if (conflictCount > 1) {
      diagnostics.duplicate_conflict = true;
      diagnostics.duplicate_conflict_count = conflictCount;
      diagnostics.duplicate_conflict_resolution = "kept_highest_confidence_per_insert_key";
      if (diagnostics.edge_pool_selected === true && row.tier !== "edge") {
        diagnostics.edge_pool_selection_reason = "duplicate_conflict";
        diagnostics.final_edge_eligible = false;
      }
    } else {
      diagnostics.duplicate_conflict = false;
    }
    diagnostics.upsert_tier_overwrite = false;
    row.model_diagnostics = diagnostics;
  }

  // Dedupe inside the same scanner run before inserting.
  // This fixes duplicate key errors when the same player/prop/line appears twice in one batch.
  const uniqueRowsMap = new Map<string, any>();

  for (const row of rows) {
    const key = [
      row.pick_date,
      row.sport,
      row.tier,
      row.player_name ?? "",
      row.prop_type ?? "",
      row.direction ?? "",
      row.line ?? -9999,
    ].join("|");

    const existing = uniqueRowsMap.get(key);

    // Keep the higher-confidence duplicate if there is one.
    if (!existing || Number(row.confidence ?? 0) > Number(existing.confidence ?? 0)) {
      uniqueRowsMap.set(key, row);
    }
  }

  const uniqueRows = Array.from(uniqueRowsMap.values());

  let inserted = 0;

  if (uniqueRows.length && !options.diagnosticsOnly) {
    const supabaseUrl = getEnv("PROJECT_URL")?.trim() ?? getEnv("SUPABASE_URL")?.trim();
    const {
      key: serviceRoleKey,
      sourceName: insertClientAuthSource,
      decodedRole: insertClientDecodedRole,
      presence: insertClientPresence,
    } = resolveServiceRoleAuth();

    let analyzerSourceCount = 0;
    let scannerSourceCount = 0;
    for (const r of uniqueRows) {
      const md = (r as { model_diagnostics?: Record<string, unknown> }).model_diagnostics ?? {};
      if (md.confidenceSource === "analyzer") analyzerSourceCount++;
      else scannerSourceCount++;
    }

    const presenceStr = insertClientPresence.length ? insertClientPresence.join(",") : "none";

    console.log(
      `[scanner][persist] sport=${sport} ` +
        `presence=${presenceStr} ` +
        `selected_source=${insertClientAuthSource} ` +
        `decoded_role=${insertClientDecodedRole} ` +
        `rows_to_insert=${uniqueRows.length} ` +
        `rows_with_confidenceSource_analyzer=${analyzerSourceCount} ` +
        `rows_with_confidenceSource_scanner=${scannerSourceCount}`,
    );

    if (!supabaseUrl) {
      throw new Error("Missing PROJECT_URL/SUPABASE_URL for daily_picks insert");
    }
    if (!serviceRoleKey || insertClientDecodedRole !== "service_role") {
      console.error(
        `[scanner][persist] insert_error code=AUTH_NOT_SERVICE_ROLE ` +
          `presence=${presenceStr} selected_source=${insertClientAuthSource} decoded_role=${insertClientDecodedRole} — ` +
          `refusing to attempt RLS-doomed insert. Set SERVICE_ROLE_KEY (or MASTER_SUPABASE_SERVICE_KEY) ` +
          `to a JWT whose payload.role === "service_role".`,
      );
    } else {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        },
      });

      // Clear all rows for this sport/date first, not just _pending.
      // This prevents conflicts with previously promoted edge/daily rows too.
      const { error: deleteError } = await supabase
        .from("daily_picks")
        .delete()
        .eq("pick_date", today)
        .eq("sport", sport);

      if (deleteError) {
        console.error(`[${sport}] pre-insert delete error:`, deleteError);
      }

      // analyzer-finalize.v1 hard insert-time guard — final defense.
      // Drops any edge/daily/value row not analyzer-finalized. Applies to
      // every sport, including NBA, MLB, NHL, UFC, and future sports.
      const guardResult = applyAnalyzerFinalizeInsertGuard(
        uniqueRows,
        `sport_scan:${sport}`,
      );
      const guardedRows = guardResult.rows;

      const { error, count } = await supabase
        .from("daily_picks")
        .insert(guardedRows, { count: "exact" });

      if (error) {
        console.error(
          `[scanner][persist] insert_error code=${(error as { code?: string }).code ?? "unknown"} ` +
            `message=${error.message} ` +
            `details=${(error as { details?: string }).details ?? ""}`,
        );
      } else {
        inserted = count ?? guardedRows.length;
      }

      // NBA-only: persist analyzer-deferred candidates to the resume queue so
      // process-nba-analyzer-queue can finalize them in later batches and
      // promote qualifying picks to tier='edge'. Enqueue happens AFTER the
      // daily_picks insert succeeds so live picks always exist before the
      // queue references them.
      if (sport === "nba") {
        try {
          const queueEntries: ScoredPlay[] = [];
          for (const p of budgetDeferred) queueEntries.push(p);
          for (const p of rateLimitDeferred) queueEntries.push(p);
          if (queueEntries.length > 0) {
            await enqueueNbaAnalyzerCandidates(supabase, today, queueEntries);
          }
        } catch (qErr) {
          console.error(`[${sport}] nba_analyzer_queue enqueue failed:`, qErr);
        }
      } else {
        // Generic analyzer_queue for MLB / NHL / UFC / future sports.
        // Routes deferred candidates (rate-limit, timeout, 5xx, network,
        // budget cap) so process-analyzer-queue can finalize them later.
        try {
          const endpoint = ANALYZER_ENDPOINT[sport];
          if (!endpoint) {
            // Sport has no analyzer endpoint at all — record once and bail.
            console.warn(
              `[scanner][analyzer-required] sport=${sport} reason=missing_analyzer_endpoint queued=0`,
            );
          } else {
            const buildEntry = (
              p: ScoredPlay,
              reason: "rate_limited" | "analyzer_timeout" | "budget_exceeded" | "http_5xx" | "network",
              retry_after_ms: number | undefined,
              analyzer_body: Record<string, unknown> | null,
            ) => {
              const intendedTier =
                ((p.model_diagnostics ?? {}) as Record<string, unknown>).intended_tier as
                  | string
                  | undefined ?? null;
              const preGateTier =
                ((p.model_diagnostics ?? {}) as Record<string, unknown>).preGateTier as
                  | string
                  | undefined ?? null;
              const candidate_payload: Record<string, unknown> = {
                event_id: p.event_id ?? null,
                home_team: p.home_team ?? null,
                away_team: p.away_team ?? null,
                commence_time: p.commence_time ?? null,
                odds: p.odds,
                player_name: p.player_name ?? null,
                team: p.team ?? null,
                opponent: p.opponent ?? null,
                prop_type: p.prop_type,
                line: p.line,
                direction: p.direction,
                bet_type: p.bet_type,
                intended_tier: intendedTier,
                pre_gate_tier: preGateTier,
                pick_date: today,
                sport,
                model_diagnostics: p.model_diagnostics ?? null,
                raw_confidence: p.raw_confidence ?? null,
                ev_pct: p.ev_pct ?? null,
                edge: p.edge ?? null,
                spread_line: p.spread_line ?? null,
                total_line: p.total_line ?? null,
                reasoning: p.reasoning ?? null,
              };
              const analyzer_payload = analyzer_body ?? {
                player: p.player_name,
                prop_type: p.prop_type,
                line: p.line,
                over_under: normalizeDirection(p.direction),
                opponent: p.opponent || "",
                team: p.team || null,
                home_team: p.home_team || null,
                away_team: p.away_team || null,
                sport,
                bet_type: "player_prop",
              };
              return {
                play: p,
                analyzerEndpoint: endpoint,
                analyzerPayload: analyzer_payload,
                candidatePayload: candidate_payload,
                intendedTier,
                preGateTier,
                scannerTraceId: null,
                classification: { reason, retry_after_ms },
              };
            };

            const entries: Array<ReturnType<typeof buildEntry>> = [];
            for (const p of budgetDeferred) {
              entries.push(buildEntry(p, "budget_exceeded", 600_000, null));
            }
            for (const td of transientDeferred) {
              entries.push(
                buildEntry(td.play, td.reason, td.retry_after_ms, td.analyzer_body),
              );
            }
            if (entries.length > 0) {
              const res = await enqueueGenericAnalyzerCandidates(
                supabase,
                today,
                sport,
                entries,
              );
              console.log(
                `[analyzer-queue] enqueue sport=${sport} endpoint=${endpoint} ` +
                  `enqueued=${res.enqueued} refused=${res.refused} ` +
                  `budget=${budgetDeferred.length} transient=${transientDeferred.length}`,
              );
            }
          }
        } catch (qErr) {
          console.error(`[${sport}] analyzer_queue enqueue failed:`, qErr);
        }
      }
    }
  }

  const tierCounts = { edge: 0, daily: 0, value: 0, pass: 0 };
  for (const r of uniqueRows) {
    const t = String(r.tier ?? "");
    if (t === "edge" || t === "daily" || t === "value") {
      tierCounts[t as "edge" | "daily" | "value"]++;
    }
  }
  // PASS = analyzer-emitted Pass verdicts plus anything that cleared
  // prefilter but never returned from the analyzer. Both are excluded
  // from public pick surfaces.
  const analyzerSilent = Math.max(0, top.length - validated.length);
  tierCounts.pass = passPicks.length + analyzerSilent;

  const rejected: Record<string, number> = {
    passVerdict: passPicks.length,
    lowConfidence: drops.conf,
    missingData: droppedNoGameDate,
    notAnalyzedDueToCap: Math.max(0, prefiltered.length - top.length),
    analyzerSilent,
    contradictoryVerdict: passVerdictBlocked,
  };
  if (sport === "nba") {
    rejected.nbaHardSafetyDropped = nbaHardSafetyDropped;
    rejected.nbaNonAnalyzerDropped = nbaNonAnalyzerDropped;
    rejected.nbaEdgeGateBlocked = eligible.filter(p => {
      const g = nbaGateCache.get(tierKey(p));
      return g && !g.ok;
    }).length;
  }
  rejected.nonAnalyzerDroppedBySport = nonAnalyzerDroppedBySport;
  // Per-sport analyzer-required visibility: surface how many user-facing rows
  // were blocked because confidenceSource !== "analyzer". MLB/NHL today will
  // show this >0 until the analyzer queue drains.
  for (const [sportKey, n] of Object.entries(nonAnalyzerDroppedBySport)) {
    if (n > 0) {
      const endpoint = ANALYZER_ENDPOINT[sportKey] ?? "null";
      console.warn(
        `[scanner][analyzer-required] sport=${sportKey} reason=non_analyzer_source endpoint=${endpoint} skipped_user_facing=${n}`,
      );
    }
  }

  const canonicalFinalizedCount = validated.filter(
    (p) => (p.model_diagnostics ?? {}).confidenceSource === "analyzer",
  ).length;
  const edgeSelectedCount = uniqueRows.filter((r) => r.tier === "edge").length;

  console.log(
    `[${sport}] games=${stats.games} scheduled=${stats.scheduled_games} ` +
    `events=${stats.events} players=${stats.players} ` +
    `propLines=${stats.propLines} lines=${stats.lines} ` +
    `candidates=${stats.candidates} scanned=${scanned} ` +
    `prefiltered=${prefiltered.length} validated=${validated.length} ` +
    `analyzerPool=${top.length}/${prefiltered.length} cap=${analyzerPoolCap} ` +
    `inserted=${inserted} droppedNoGameDate=${droppedNoGameDate} ` +
    `tiers=${JSON.stringify(tierCounts)} ` +
    `rejected=${JSON.stringify(rejected)} ` +
    `analyzer=${JSON.stringify(analyzerDiagnostics)} (minConf=${minConf})`
  );

  return {
    sport,
    scanned,
    validated: validated.length,
    inserted,
    stats,
    tiers: tierCounts,
    rejected,
    analyzer: analyzerDiagnostics,
    droppedNoGameDate,
    diagnostics_only: options.diagnosticsOnly === true,
    rejected_low_confidence_top_25: rejectedLowConfidenceTop,
    rejected_missing_data_top_25: rejectedMissingDataTop,
    analyzer_error_candidates: analyzerErrorCandidates,
    target_trace_results: traceResults,
    candidate_pool_size_before_analyzer: prefiltered.length,
    candidate_pool_size_after_analyzer: top.length,
    canonical_finalized_count: canonicalFinalizedCount,
    edge_selected_count: edgeSelectedCount,
    analyzer_pool_cap: analyzerPoolCap,
    analyzer_pool_selected_count: top.length,
    analyzer_calls_attempted: analyzerDiagnostics.callsAttempted,
    analyzer_calls_succeeded: analyzerDiagnostics.callsSucceeded,
    analyzer_calls_failed: analyzerDiagnostics.callsFailed,
    analyzer_pool_truncated: analyzerPool.truncated,
    analyzer_pool_excluded_candidates: analyzerPoolExcluded,
  };
}
