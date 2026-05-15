// Shared Odds API key rotation pool.
//
// One implementation, used by every Edge Function that hits the-odds-api.com.
// Status-driven (column `status` on `odds_api_keys`):
//   available | rate_limited | exhausted_quota | invalid_auth | disabled | unknown
//
// Selection order (see plan):
//   1. status='available'                       — primary LRU pool
//   2. status='rate_limited' AND past cooldown  — promote and use
//   3. status IN (exhausted_quota,unknown)
//        AND last_checked_at older than RECHECK_INTERVAL_HOURS — soft probe
//   4. app_config.odds_api_key                  — admin fallback
//   5. ODDS_API_KEY env                         — local/CI fallback
//
// Response interpretation:
//   2xx + remaining > 0  → available
//   2xx + remaining ≤ 0  → exhausted_quota (the call still succeeded)
//   401 with "invalid api key|unauthori[sz]ed|forbidden" body → invalid_auth
//   401/403 otherwise    → bump consecutive_errors; flip to invalid_auth at ≥3
//   429                  → rate_limited + rate_limited_until from Retry-After
//   5xx / network        → bump consecutive_errors; status unchanged
//   422                  → caller-side bad params; status unchanged
//
// Logs never include the raw key.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const RECHECK_INTERVAL_HOURS = 6;
const PROBE_URL = "https://api.the-odds-api.com/v4/sports/";

export const ENV_FALLBACK_ID = "env-fallback";
export const APP_CONFIG_ID = "app-config";

export type KeyInfo = { id: string; key: string; source: "pool" | "app_config" | "env" };

export type RotationErrorKind =
  | "no_usable_keys"
  | "upstream_5xx"
  | "auth_error"
  | "rate_limited"
  | "invalid_request"
  | "no_odds";

export type RotationError = {
  kind: RotationErrorKind;
  status?: number;
  retryAfterMs?: number;
  detail?: string;
};

const INVALID_AUTH_BODY = /invalid api key|unauthori[sz]ed|forbidden/i;

function nowIso(): string {
  return new Date().toISOString();
}

function isSentinel(id: string): boolean {
  return id === ENV_FALLBACK_ID || id === APP_CONFIG_ID;
}

export function parseRetryAfterHeader(resp: Response): number | null {
  const v = resp.headers.get("Retry-After") ?? resp.headers.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  const dateMs = Date.parse(v);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function probeKey(rawKey: string): Promise<Response> {
  return await fetch(`${PROBE_URL}?apiKey=${encodeURIComponent(rawKey)}`);
}

// ── Selection ────────────────────────────────────────────────────────────────

async function pickAvailable(supabase: SupabaseClient): Promise<KeyInfo | null> {
  const { data } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("status", "available")
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (data) return { id: data.id, key: data.api_key, source: "pool" };
  return null;
}

async function pickRateLimitedReady(supabase: SupabaseClient): Promise<KeyInfo | null> {
  const { data } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("status", "rate_limited")
    .lt("rate_limited_until", nowIso())
    .order("rate_limited_until", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  await supabase
    .from("odds_api_keys")
    .update({ status: "available", rate_limited_until: null })
    .eq("id", data.id);
  return { id: data.id, key: data.api_key, source: "pool" };
}

async function pickRecheckCandidate(supabase: SupabaseClient): Promise<KeyInfo | null> {
  const cutoff = new Date(Date.now() - RECHECK_INTERVAL_HOURS * 3600 * 1000).toISOString();
  // NOTE the parentheses — without them the OR short-circuits across statuses.
  const { data } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .in("status", ["exhausted_quota", "unknown"])
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  // Probe synchronously. Only return the key if the probe recovers it; otherwise
  // record the outcome and let the caller fall through to the next tier.
  try {
    const resp = await probeKey(data.api_key);
    const outcome = await classifyResponse(resp);
    await applyOutcome(supabase, data.id, outcome);
    if (outcome.status === "available") {
      return { id: data.id, key: data.api_key, source: "pool" };
    }
  } catch (e) {
    await supabase
      .from("odds_api_keys")
      .update({
        last_checked_at: nowIso(),
        consecutive_errors: (await getConsecutive(supabase, data.id)) + 1,
        last_error: `probe network error: ${String(e).slice(0, 200)}`,
      })
      .eq("id", data.id);
  }
  return null;
}

async function getConsecutive(supabase: SupabaseClient, id: string): Promise<number> {
  const { data } = await supabase
    .from("odds_api_keys")
    .select("consecutive_errors")
    .eq("id", id)
    .maybeSingle();
  return data?.consecutive_errors ?? 0;
}

export async function getNextApiKey(supabase: SupabaseClient): Promise<KeyInfo | null> {
  const a = await pickAvailable(supabase);
  if (a) return a;

  const b = await pickRateLimitedReady(supabase);
  if (b) return b;

  const c = await pickRecheckCandidate(supabase);
  if (c) return c;

  const { data: configData } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "odds_api_key")
    .maybeSingle();
  if (configData?.value) return { id: APP_CONFIG_ID, key: configData.value, source: "app_config" };

  const envKey = Deno.env.get("ODDS_API_KEY");
  if (envKey) return { id: ENV_FALLBACK_ID, key: envKey, source: "env" };

  console.error("[oddsKeyPool] no_usable_keys — all pools and fallbacks empty");
  return null;
}

// ── Outcome classification ──────────────────────────────────────────────────

type Outcome =
  | { status: "available"; remaining: number | null; used: number | null }
  | { status: "exhausted_quota"; remaining: number; used: number | null }
  | { status: "invalid_auth"; detail: string }
  | { status: "transient_auth"; detail: string }   // 401/403 but body not conclusive
  | { status: "rate_limited"; retryAfterMs: number | null }
  | { status: "transient"; detail: string }        // 5xx
  | { status: "caller_error"; detail: string };    // 422

async function classifyResponse(resp: Response): Promise<Outcome> {
  const remainingHdr = resp.headers.get("x-requests-remaining");
  const usedHdr = resp.headers.get("x-requests-used");
  const remaining = remainingHdr !== null ? Number.parseInt(remainingHdr, 10) : null;
  const used = usedHdr !== null ? Number.parseInt(usedHdr, 10) : null;

  if (resp.ok) {
    if (remaining !== null && remaining <= 0) {
      return { status: "exhausted_quota", remaining: remaining, used };
    }
    return { status: "available", remaining, used };
  }
  if (resp.status === 422) {
    const body = await resp.text().catch(() => "");
    return { status: "caller_error", detail: body.slice(0, 200) };
  }
  if (resp.status === 429) {
    return { status: "rate_limited", retryAfterMs: parseRetryAfterHeader(resp) };
  }
  if (resp.status === 401 || resp.status === 403) {
    const body = await resp.text().catch(() => "");
    if (INVALID_AUTH_BODY.test(body)) {
      return { status: "invalid_auth", detail: body.slice(0, 200) };
    }
    return { status: "transient_auth", detail: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
  }
  if (resp.status >= 500) {
    return { status: "transient", detail: `HTTP ${resp.status}` };
  }
  // Other 4xx — treat as caller error so we don't blame the key.
  const body = await resp.text().catch(() => "");
  return { status: "caller_error", detail: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
}

async function applyOutcome(
  supabase: SupabaseClient,
  keyId: string,
  outcome: Outcome,
): Promise<void> {
  if (isSentinel(keyId)) return;

  const base: Record<string, unknown> = {
    last_checked_at: nowIso(),
    last_used_at: nowIso(),
  };

  switch (outcome.status) {
    case "available": {
      if (outcome.remaining !== null) base.requests_remaining = outcome.remaining;
      if (outcome.used !== null) base.requests_used = outcome.used;
      base.status = "available";
      base.consecutive_errors = 0;
      base.last_error = null;
      // Keep exhausted_at column in sync for the rollback window — clear it.
      base.exhausted_at = null;
      base.is_active = true;
      break;
    }
    case "exhausted_quota": {
      base.requests_remaining = outcome.remaining;
      if (outcome.used !== null) base.requests_used = outcome.used;
      base.status = "exhausted_quota";
      base.consecutive_errors = 0;
      base.exhausted_at = nowIso();
      break;
    }
    case "rate_limited": {
      const until = new Date(Date.now() + (outcome.retryAfterMs ?? 60_000)).toISOString();
      base.status = "rate_limited";
      base.rate_limited_until = until;
      base.last_error = "HTTP 429";
      break;
    }
    case "invalid_auth": {
      base.status = "invalid_auth";
      base.last_error = outcome.detail;
      base.is_active = false;
      base.exhausted_at = nowIso();
      break;
    }
    case "transient_auth": {
      // Bump consecutive_errors; flip to invalid_auth at ≥3.
      const prev = await getConsecutive(supabase, keyId);
      const next = prev + 1;
      base.consecutive_errors = next;
      base.error_count = (await getErrorCount(supabase, keyId)) + 1;
      base.last_error = outcome.detail;
      if (next >= 3) {
        base.status = "invalid_auth";
        base.is_active = false;
        base.exhausted_at = nowIso();
      }
      break;
    }
    case "transient": {
      base.consecutive_errors = (await getConsecutive(supabase, keyId)) + 1;
      base.error_count = (await getErrorCount(supabase, keyId)) + 1;
      base.last_error = outcome.detail;
      break;
    }
    case "caller_error": {
      // Don't blame the key.
      break;
    }
  }

  await supabase.from("odds_api_keys").update(base).eq("id", keyId);
}

async function getErrorCount(supabase: SupabaseClient, id: string): Promise<number> {
  const { data } = await supabase
    .from("odds_api_keys")
    .select("error_count")
    .eq("id", id)
    .maybeSingle();
  return data?.error_count ?? 0;
}

// ── Public surface ──────────────────────────────────────────────────────────

/** Update a key's bookkeeping after a successful fetch (when caller drives the fetch). */
export async function updateKeyUsage(
  supabase: SupabaseClient,
  keyId: string,
  resp: Response,
): Promise<void> {
  if (isSentinel(keyId)) return;
  const outcome = await classifyResponse(resp.clone()); // clone so caller can still read body
  await applyOutcome(supabase, keyId, outcome);
}

/** Mark a key as failed with a specific status. Mainly used by recheck/admin paths. */
export async function setKeyStatus(
  supabase: SupabaseClient,
  keyId: string,
  status:
    | "available"
    | "rate_limited"
    | "exhausted_quota"
    | "invalid_auth"
    | "disabled"
    | "unknown",
  extra: Partial<{
    requests_remaining: number;
    requests_used: number;
    rate_limited_until: string;
    last_error: string;
    consecutive_errors: number;
  }> = {},
): Promise<void> {
  if (isSentinel(keyId)) return;
  await supabase
    .from("odds_api_keys")
    .update({ status, last_checked_at: nowIso(), ...extra })
    .eq("id", keyId);
}

/**
 * Fetch with rotation. Tries up to `maxRetries` different keys (not the same
 * key twice in the auth/transient case). Returns:
 *   { resp, keyId }            — on success
 *   { error: RotationError }   — on all retries exhausted or unrecoverable
 *
 * The `resp` is the raw Response on success. `updateKeyUsage` has already been
 * called for the returned key, so callers do not need to re-update on success.
 */
export async function fetchWithRotation(
  supabase: SupabaseClient,
  buildUrl: (apiKey: string) => string,
  opts: { maxRetries?: number; signal?: AbortSignal } = {},
): Promise<{ resp: Response; keyId: string } | { error: RotationError }> {
  const maxRetries = opts.maxRetries ?? 3;
  const tried = new Set<string>();
  let lastError: RotationError | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const keyInfo = await getNextApiKey(supabase);
    if (!keyInfo) {
      return { error: { kind: "no_usable_keys" } };
    }
    // Avoid retrying the exact same DB row in the same call (sentinels OK to reuse).
    if (!isSentinel(keyInfo.id) && tried.has(keyInfo.id)) {
      // No fresh distinct key available → bail.
      return { error: lastError ?? { kind: "no_usable_keys" } };
    }
    tried.add(keyInfo.id);

    let resp: Response;
    try {
      resp = await fetch(buildUrl(keyInfo.key), { signal: opts.signal });
    } catch (e) {
      await applyOutcome(supabase, keyInfo.id, {
        status: "transient",
        detail: `network: ${String(e).slice(0, 200)}`,
      });
      lastError = { kind: "upstream_5xx", detail: String(e).slice(0, 200) };
      continue;
    }

    const outcome = await classifyResponse(resp.clone());
    await applyOutcome(supabase, keyInfo.id, outcome);

    switch (outcome.status) {
      case "available":
      case "exhausted_quota":
        // Successful call. Even on exhausted_quota the response is valid.
        return { resp, keyId: keyInfo.id };
      case "caller_error":
        return { error: { kind: "invalid_request", status: resp.status, detail: outcome.detail } };
      case "rate_limited": {
        lastError = {
          kind: "rate_limited",
          status: resp.status,
          retryAfterMs: outcome.retryAfterMs ?? undefined,
        };
        // Try a different key immediately; do not sleep here so callers stay responsive.
        continue;
      }
      case "invalid_auth":
      case "transient_auth":
        lastError = { kind: "auth_error", status: resp.status, detail: outcome.detail };
        continue;
      case "transient":
        lastError = { kind: "upstream_5xx", status: resp.status, detail: outcome.detail };
        continue;
    }
  }

  return { error: lastError ?? { kind: "no_usable_keys" } };
}

// ── Stats helper used by both key-admin and odds-health-check ──────────────

export type KeyPoolStats = {
  total: number;
  byStatus: {
    available: number;
    rate_limited: number;
    exhausted_quota: number;
    invalid_auth: number;
    disabled: number;
    unknown: number;
  };
  usableNow: number;
  staleExhaustedWithQuotaRemaining: number;
  usableRequestsRemaining: number;
  totalRequestsRemainingAllKeys: number;
  oldestLastChecked: string | null;
  newestLastChecked: string | null;
};

export async function loadKeyPoolStats(supabase: SupabaseClient): Promise<KeyPoolStats> {
  // PostgREST caps every `select()` at `max_rows` (default 1000) regardless of
  // .limit(). Use HEAD-only count queries for exact byStatus totals, and
  // paginate via .range() to sum requests_remaining without truncation.
  const STATUSES = ["available", "rate_limited", "exhausted_quota", "invalid_auth", "disabled", "unknown"] as const;
  type Status = typeof STATUSES[number];

  const empty: Record<Status, number> = {
    available: 0, rate_limited: 0, exhausted_quota: 0, invalid_auth: 0, disabled: 0, unknown: 0,
  };
  const byStatus = { ...empty };

  // Exact counts per status — head:true means PostgREST returns no rows, just Count-Range.
  const countQueries = STATUSES.map((s) =>
    supabase
      .from("odds_api_keys")
      .select("*", { count: "exact", head: true })
      .eq("status", s)
      .then((r) => ({ s, count: r.count ?? 0, error: r.error })),
  );
  const totalQuery = supabase
    .from("odds_api_keys")
    .select("*", { count: "exact", head: true })
    .then((r) => ({ count: r.count ?? 0, error: r.error }));

  const [totalRes, ...statusRes] = await Promise.all([totalQuery, ...countQueries]);
  for (const r of statusRes) byStatus[r.s] = r.count;
  const total = totalRes.count;

  // Sum requests_remaining + collect last_checked_at extremes via paginated range().
  let usableRequestsRemaining = 0;
  let totalRequestsRemainingAllKeys = 0;
  let staleExhaustedWithQuotaRemaining = 0;
  let oldest: string | null = null;
  let newest: string | null = null;
  const oneHourAgo = Date.now() - 3600_000;
  const PAGE = 1000;
  for (let offset = 0; offset < total; offset += PAGE) {
    const { data, error } = await supabase
      .from("odds_api_keys")
      .select("status, requests_remaining, last_checked_at")
      .range(offset, offset + PAGE - 1);
    if (error) break;
    for (const r of (data ?? []) as Array<{ status: Status; requests_remaining: number | null; last_checked_at: string | null }>) {
      const rem = r.requests_remaining ?? 0;
      totalRequestsRemainingAllKeys += rem;
      if (r.status === "available") usableRequestsRemaining += rem;
      if (r.status === "exhausted_quota" && rem > 0) {
        const checkedMs = r.last_checked_at ? Date.parse(r.last_checked_at) : 0;
        if (!r.last_checked_at || checkedMs < oneHourAgo) staleExhaustedWithQuotaRemaining += 1;
      }
      if (r.last_checked_at) {
        if (!oldest || r.last_checked_at < oldest) oldest = r.last_checked_at;
        if (!newest || r.last_checked_at > newest) newest = r.last_checked_at;
      }
    }
    if ((data?.length ?? 0) < PAGE) break;
  }

  return {
    total,
    byStatus,
    usableNow: byStatus.available,
    staleExhaustedWithQuotaRemaining,
    usableRequestsRemaining,
    totalRequestsRemainingAllKeys,
    oldestLastChecked: oldest,
    newestLastChecked: newest,
  };
}

export type RecheckResult = {
  scanned: number;
  recovered: number;
  stillExhausted: number;
  invalid: number;
  rateLimited: number;
  errors: number;
  errorBreakdown: {
    network: number;
    upstream_5xx: number;
    transient_auth: number;
    db_update_failed: number;
    unknown: number;
  };
  sampleErrors: Array<{ kind: string; status?: number; detail: string }>;
};

/**
 * Recheck up to `batchSize` exhausted/rate-limited/unknown keys against
 * /v4/sports/?apiKey=<KEY>. Used by both the admin button and the cron job.
 *
 * Returns aggregate counts and a breakdown of error categories plus up to 3
 * REDACTED sample errors. Never returns or logs raw API keys — only HTTP
 * statuses and (truncated) response bodies, which the Odds API does not echo
 * the key into.
 */
export async function recheckKeys(
  supabase: SupabaseClient,
  batchSize = 100,
): Promise<RecheckResult> {
  const cutoff = new Date(Date.now() - RECHECK_INTERVAL_HOURS * 3600 * 1000).toISOString();
  const { data, error: selErr } = await supabase
    .from("odds_api_keys")
    .select("id, api_key") // raw key is needed in-process to probe; never logged or returned
    .in("status", ["exhausted_quota", "rate_limited", "unknown"])
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);

  const rows = (data ?? []) as Array<{ id: string; api_key: string }>;
  let recovered = 0;
  let stillExhausted = 0;
  let invalid = 0;
  let rateLimited = 0;
  let errors = 0;
  const errorBreakdown = { network: 0, upstream_5xx: 0, transient_auth: 0, db_update_failed: 0, unknown: 0 };
  const sampleErrors: Array<{ kind: string; status?: number; detail: string }> = [];

  function recordSample(s: { kind: string; status?: number; detail: string }) {
    if (sampleErrors.length < 3) sampleErrors.push(s);
  }

  if (selErr) {
    console.error("[recheckKeys] select failed:", selErr.message);
    return {
      scanned: 0, recovered: 0, stillExhausted: 0, invalid: 0, rateLimited: 0,
      errors: 1, errorBreakdown: { ...errorBreakdown, unknown: 1 },
      sampleErrors: [{ kind: "select_failed", detail: selErr.message.slice(0, 200) }],
    };
  }

  for (const row of rows) {
    // Probe network errors land here.
    let resp: Response;
    try {
      resp = await probeKey(row.api_key);
    } catch (e) {
      errors += 1;
      errorBreakdown.network += 1;
      const detail = String(e).slice(0, 200);
      recordSample({ kind: "network", detail });
      try {
        await supabase
          .from("odds_api_keys")
          .update({
            last_checked_at: nowIso(),
            consecutive_errors: (await getConsecutive(supabase, row.id)) + 1,
            last_error: `recheck network: ${detail}`,
          })
          .eq("id", row.id);
      } catch (dbErr) {
        errorBreakdown.db_update_failed += 1;
        console.error("[recheckKeys] db update after network err failed:", (dbErr as Error)?.message ?? dbErr);
      }
      continue;
    }

    // Classification + DB update — applyOutcome can fail (e.g. CHECK constraint).
    try {
      const outcome = await classifyResponse(resp);
      await applyOutcome(supabase, row.id, outcome);
      switch (outcome.status) {
        case "available":
          recovered += 1;
          break;
        case "exhausted_quota":
          stillExhausted += 1;
          break;
        case "invalid_auth":
          invalid += 1;
          break;
        case "rate_limited":
          rateLimited += 1;
          break;
        case "transient":
          errors += 1;
          errorBreakdown.upstream_5xx += 1;
          recordSample({ kind: "upstream_5xx", status: resp.status, detail: outcome.detail });
          break;
        case "transient_auth":
          errors += 1;
          errorBreakdown.transient_auth += 1;
          recordSample({ kind: "transient_auth", status: resp.status, detail: outcome.detail });
          break;
        case "caller_error":
          errors += 1;
          errorBreakdown.unknown += 1;
          recordSample({ kind: "caller_error", status: resp.status, detail: outcome.detail });
          break;
      }
    } catch (e) {
      errors += 1;
      errorBreakdown.db_update_failed += 1;
      const detail = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      recordSample({ kind: "db_update_failed", status: resp.status, detail });
      console.error(`[recheckKeys] applyOutcome failed for key id=${row.id} httpStatus=${resp.status}:`, detail);
    }
  }

  console.log(
    `[recheckKeys] scanned=${rows.length} recovered=${recovered} stillExhausted=${stillExhausted} ` +
    `invalid=${invalid} rateLimited=${rateLimited} errors=${errors} ` +
    `breakdown=${JSON.stringify(errorBreakdown)}`,
  );

  return { scanned: rows.length, recovered, stillExhausted, invalid, rateLimited, errors, errorBreakdown, sampleErrors };
}
