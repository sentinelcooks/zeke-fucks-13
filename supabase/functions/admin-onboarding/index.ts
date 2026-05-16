import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors src/lib/odds.ts (Deno can't import from src/).
const parseAmericanOdds = (odds: unknown): number | null => {
  if (odds === null || odds === undefined || odds === "") return null;
  const n = Number(String(odds).trim().replace(/^\+/, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const americanToDecimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
const profitUnits = (odds: unknown, result: string | null, stake = 1): number | null => {
  const r = (result || "").toLowerCase();
  if (r === "push") return 0;
  const win = r === "hit" || r === "win";
  const loss = r === "miss" || r === "loss";
  if (!win && !loss) return null;
  if (loss) return -stake;
  const a = parseAmericanOdds(odds);
  if (a === null) return null;
  return stake * (americanToDecimal(a) - 1);
};

const computeStats = (picks: any[]) => {
  let wins = 0, losses = 0, pushes = 0, pending = 0;
  let edgeSum = 0, edgeCount = 0;
  let profitSum = 0, stakeSum = 0;
  for (const p of picks) {
    const r = (p.result || "pending").toLowerCase();
    if (r === "hit" || r === "win") wins++;
    else if (r === "miss" || r === "loss") losses++;
    else if (r === "push") pushes++;
    else pending++;
    if (typeof p.edge_value === "number") { edgeSum += p.edge_value; edgeCount++; }
    const stake = typeof p.stake_units === "number" ? p.stake_units : 1;
    const profit = typeof p.profit_units === "number"
      ? p.profit_units
      : profitUnits(p.odds, p.result, stake);
    if (profit !== null && r !== "" && r !== "pending") {
      profitSum += profit;
      stakeSum += stake;
    }
  }
  const resolved = wins + losses;
  const hit_rate = resolved > 0 ? (wins / resolved) * 100 : 0;
  const avg_edge = edgeCount > 0 ? edgeSum / edgeCount : 0;
  const roi_pct = stakeSum > 0 ? (profitSum / stakeSum) * 100 : 0;

  const chrono = [...picks].reverse();
  let streakType: "W" | "L" | null = null;
  let streakCount = 0;
  for (const p of chrono) {
    const r = (p.result || "").toLowerCase();
    let t: "W" | "L" | null = null;
    if (r === "hit" || r === "win") t = "W";
    else if (r === "miss" || r === "loss") t = "L";
    else continue;
    if (streakType === t) streakCount++;
    else { streakType = t; streakCount = 1; }
  }
  return {
    total: picks.length, resolved, wins, losses, pushes, pending,
    hit_rate, avg_edge,
    total_profit_units: profitSum, roi_pct,
    current_streak: streakType ? { type: streakType, count: streakCount } : null,
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { password, action } = body;
    const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET_PASSWORD");
    if (!ADMIN_SECRET || password !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "list_responses") {
      const { data, error } = await supabaseAdmin
        .from("onboarding_responses")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const userIds = (data || []).map((r: any) => r.user_id);
      const profiles: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profileData } = await supabaseAdmin
          .from("profiles")
          .select("id, email, display_name")
          .in("id", userIds);
        (profileData || []).forEach((p: any) => { profiles[p.id] = p; });
      }

      const enriched = (data || []).map((r: any) => ({
        ...r,
        email: profiles[r.user_id]?.email || null,
        display_name: profiles[r.user_id]?.display_name || null,
      }));

      return new Response(JSON.stringify({ responses: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list_edge_history" || action === "list_picks_history") {
      const { start_date, end_date, sport, model, league, result_filter, limit } = body;

      // Explicit narrow column list — avoid SELECT * which was triggering statement timeouts.
      const HISTORY_COLUMNS = [
        "id","pick_date","sport","league","home_team","away_team","team","opponent",
        "player_name","prop_type","bet_type","line","direction","odds","hit_rate",
        "result","created_at","tier","status","model_used","model_version","confidence",
        "edge_value","opening_odds","closing_odds","clv","stake_units","profit_units","graded_at",
      ].join(",");

      const defaultStart = (daysBack: number) => {
        const d = new Date(); d.setDate(d.getDate() - daysBack);
        return d.toISOString().slice(0, 10);
      };
      const appliedStart = start_date || defaultStart(30);
      const appliedLimit = Math.min(Number(limit) || 500, 1000);

      let q = supabaseAdmin
        .from("daily_picks")
        .select(HISTORY_COLUMNS)
        .gte("pick_date", appliedStart)
        .order("pick_date", { ascending: false })
        .limit(appliedLimit);

      if (end_date) q = q.lte("pick_date", end_date);

      // Edge History adds a selective server-side filter on tier; Picks History does it in JS.
      if (action === "list_edge_history") {
        q = q.eq("tier", "edge");
      }

      const { data, error } = await q;
      if (error) throw error;
      const rawRows: any[] = data || [];

      // Action-specific JS-side filtering.
      const rawForAction = action === "list_edge_history"
        ? rawRows.filter((r) => String(r.status ?? "").toLowerCase().trim() !== "empty_slate")
        : rawRows.filter((r) => {
            const t = String(r.tier ?? "").toLowerCase().trim();
            const s = String(r.status ?? "").toLowerCase().trim();
            return t !== "edge" && t !== "_pending" && s !== "empty_slate";
          });

      // Optional UI-driven filters.
      let picks = rawForAction;
      if (sport && sport !== "all") picks = picks.filter((r) => (r.sport || "").toLowerCase() === String(sport).toLowerCase());
      if (model && model !== "all") picks = picks.filter((r) => r.model_used === model);
      if (league && league !== "all") picks = picks.filter((r) => r.league === league);
      if (result_filter && result_filter !== "all") {
        picks = picks.filter((r) => {
          const res = (r.result || "pending").toLowerCase();
          if (result_filter === "pending") return res === "pending" || !r.result;
          if (result_filter === "win") return res === "hit" || res === "win";
          if (result_filter === "loss") return res === "miss" || res === "loss";
          return res === result_filter;
        });
      }

      const tierCounts = rawRows.reduce((acc: Record<string, number>, r: any) => {
        const k = String(r.tier ?? "null").toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc;
      }, {});
      const statusCounts = rawRows.reduce((acc: Record<string, number>, r: any) => {
        const k = String(r.status ?? "null").toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc;
      }, {});

      const debug = {
        raw_count: rawRows.length,
        action_filtered_count: rawForAction.length,
        returned_count: picks.length,
        applied_start_date: appliedStart,
        applied_end_date: end_date || null,
        limit: appliedLimit,
        tier_counts: tierCounts,
        status_counts: statusCounts,
      };

      const modelOptions = Array.from(
        new Set(rawForAction.map((p: any) => p.model_used).filter((m: any) => m && m.length > 0))
      ).sort();
      const leagueOptions = Array.from(
        new Set(rawForAction.map((p: any) => p.league).filter((l: any) => l && l.length > 0))
      ).sort();

      return new Response(JSON.stringify({
        picks,
        stats: computeStats(picks),
        filters: { models: modelOptions, leagues: leagueOptions },
        debug,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_edge_result" || action === "update_picks_result") {
      const { pick_id, result } = body;
      const allowed = ["hit", "miss", "push", "pending"];
      if (!pick_id || !allowed.includes(result)) {
        return new Response(JSON.stringify({ error: "Invalid pick_id or result" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await supabaseAdmin
        .from("daily_picks")
        .select("odds, stake_units")
        .eq("id", pick_id)
        .maybeSingle();

      const stake = typeof existing?.stake_units === "number" ? existing.stake_units : 1;
      const profit = result === "pending" ? null : profitUnits(existing?.odds, result, stake);
      const graded_at = result === "pending" ? null : new Date().toISOString();

      const { error } = await supabaseAdmin
        .from("daily_picks")
        .update({ result, profit_units: profit, graded_at })
        .eq("id", pick_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, profit_units: profit, graded_at }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
