// ─────────────────────────────────────────────────────────────
// Snapshot edge function — NHL line history
// Pulls Odds API once per scheduled invocation, writes to odds_history.
// Honors quota guard: skips if remainingPct < 20%.
// Schedule controlled by ODDS_SNAPSHOT_INTERVAL_MIN (default 60).
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkOddsQuota, recordOddsApiUsage } from "../_shared/odds_intelligence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SPORT_KEYS: Record<string, string> = {
  nhl: "icehockey_nhl",
  nba: "basketball_nba",
  mlb: "baseball_mlb",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const sport = url.pathname.split("/").filter(Boolean).pop() || "nhl";
  const oddsSport = SPORT_KEYS[sport] || SPORT_KEYS.nhl;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Quota guard — skip if low
  const quota = await checkOddsQuota(supabase);
  if (!quota.ok) {
    const msg = `WARN: skipping ${sport} snapshot, quota at ${(quota.remainingPct * 100).toFixed(1)}% (${quota.remaining} remaining)`;
    console.warn(msg);
    return json({ skipped: true, reason: "quota_low", quota });
  }

  // Pick the freshest active key
  const { data: keys } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("is_active", true)
    .is("exhausted_at", null)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);

  let apiKey: string | undefined = keys?.[0]?.api_key;
  let keyId: string | null = keys?.[0]?.id || null;

  if (!apiKey) {
    // Fallback: try admin-configured key in app_config
    const { data: configData } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "odds_api_key")
      .single();
    if (configData?.value) {
      apiKey = configData.value;
      keyId = "app-config";
    }
  }

  if (!apiKey) apiKey = Deno.env.get("ODDS_API_KEY");
  if (!apiKey) return json({ error: "no_api_key" }, 500);

  const markets = ["h2h", "spreads", "totals"];
  const regions = ["us", "us2", "eu"];
  const books = ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars"];

  const apiUrl =
    `https://api.the-odds-api.com/v4/sports/${oddsSport}/odds/?apiKey=${apiKey}` +
    `&regions=${regions.join(",")}&markets=${markets.join(",")}` +
    `&bookmakers=${books.join(",")}&oddsFormat=american`;

  const resp = await fetch(apiUrl);
  const remaining = parseInt(resp.headers.get("x-requests-remaining") || "0", 10) || null;
  const used = parseInt(resp.headers.get("x-requests-used") || "0", 10) || null;

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`Odds API ${resp.status}:`, text);
    await recordOddsApiUsage(supabase, {
      endpoint: `/v4/sports/${oddsSport}/odds`,
      sport,
      markets,
      regions,
      booksCount: 0,
      requestsRemaining: remaining,
      requestsUsed: used,
      keyId,
    });
    return json({ error: "odds_api_failed", status: resp.status }, 502);
  }

  const events: any[] = await resp.json();

  // Track unique books seen for cost calc
  const allBooks = new Set<string>();
  const rows: any[] = [];
  const snapshot_at = new Date().toISOString();
  for (const ev of events) {
    for (const bm of ev.bookmakers || []) {
      allBooks.add(bm.key);
      for (const mkt of bm.markets || []) {
        // Average outcome price/line per market into one row per (game, book, market)
        const outcomes = mkt.outcomes || [];
        const homeOutcome = outcomes.find((o: any) => o.name === ev.home_team) || outcomes[0];
        const awayOutcome = outcomes.find((o: any) => o.name === ev.away_team) || outcomes[1];
        rows.push({
          game_id: String(ev.id),
          sport,
          book: bm.key,
          market: mkt.key,
          price: Math.round(((homeOutcome?.price || 0) + (awayOutcome?.price || 0)) / 2) || null,
          line: homeOutcome?.point ?? null,
          snapshot_at,
        });
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("odds_history").upsert(rows, {
      onConflict: "game_id,book,market,snapshot_at",
    });
    if (error) console.error("odds_history insert failed:", error.message);
  }

  // Update key usage (skip non-DB sources)
  if (keyId && keyId !== "app-config" && remaining != null) {
    await supabase.from("odds_api_keys")
      .update({ requests_remaining: remaining, requests_used: used, last_used_at: new Date().toISOString() })
      .eq("id", keyId);
    if (remaining <= 0) {
      await supabase.from("odds_api_keys")
        .update({ exhausted_at: new Date().toISOString() })
        .eq("id", keyId);
    }
  }

  await recordOddsApiUsage(supabase, {
    endpoint: `/v4/sports/${oddsSport}/odds`,
    sport,
    markets,
    regions,
    booksCount: allBooks.size,
    requestsRemaining: remaining,
    requestsUsed: used,
    keyId,
  });

  return json({
    ok: true,
    sport,
    snapshots_written: rows.length,
    books_seen: allBooks.size,
    requests_remaining: remaining,
  });
});
