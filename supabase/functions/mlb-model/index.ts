import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callAI, AIProviderError, ANTI_GENERIC_INSTRUCTION } from "../_shared/ai-provider.ts";
import { requirePremiumAccess } from "../_shared/premium-access.ts";
import { fetchMlbGameIntelligence, type MlbGameIntelligence } from "../_shared/mlb_data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sentinel-device-id, x-session-token, x-device-fingerprint, x-request-timestamp, x-request-nonce, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Snapshot logging — fire and forget ──
async function logSnapshot(payload: Record<string, any>): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("logSnapshot: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return;
    }
    const r = await fetch(`${supabaseUrl}/rest/v1/prediction_snapshots`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error(`logSnapshot insert failed ${r.status}:`, text);
    }
  } catch (e) {
    console.error("logSnapshot failed:", (e as Error).message);
  }
}

// ── ESPN Helpers ──
const ESPN_MLB = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb";

async function fetchJSON(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`ESPN ${r.status}: ${url}`);
  return r.json();
}

// ── Data Fetching ──
async function getScoreboard() {
  const data = await fetchJSON(`${ESPN_MLB}/scoreboard`);
  return data.events || [];
}

async function getTeamSchedule(teamId: string): Promise<any[]> {
  try {
    const data = await fetchJSON(`${ESPN_MLB}/teams/${teamId}/schedule`);
    return data.events || [];
  } catch { return []; }
}

// Single source of truth — see _shared/injuries.ts
import { fetchTeamInjuries } from "../_shared/injuries.ts";

async function getTeamInjuries(teamId: string): Promise<any[]> {
  const list = await fetchTeamInjuries("mlb", { id: teamId });
  // Add isStarter flag for mlb-model's injury impact heuristics
  return list.map((i) => ({
    ...i,
    isStarter: ["SP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"].includes(i.position || ""),
  }));
}

// ── Odds API Integration ──
// ── Factor Scoring Functions ──
// Each returns 0-100 where 50 is neutral, >50 favors the prediction, <50 opposes

function scorePitcherERA(era: number, leagueAvg = 4.20): number {
  // Lower ERA = better pitcher = higher score for their team
  const diff = leagueAvg - era;
  return Math.max(0, Math.min(100, 50 + diff * 15));
}

function scorePitcherWHIP(whip: number, leagueAvg = 1.28): number {
  const diff = leagueAvg - whip;
  return Math.max(0, Math.min(100, 50 + diff * 40));
}

function scorePitcherK9(k9: number): number {
  // Higher K/9 = better, league avg ~8.5
  return Math.max(0, Math.min(100, 25 + k9 * 6));
}

function scoreBullpenERA(era: number): number {
  return Math.max(0, Math.min(100, 50 + (4.00 - era) * 12));
}

function scoreTeamBA(ba: number): number {
  // League avg ~.248
  return Math.max(0, Math.min(100, 50 + (ba - 0.248) * 500));
}

function scoreTeamOPS(ops: number): number {
  // League avg ~.710
  return Math.max(0, Math.min(100, 50 + (ops - 0.710) * 150));
}

function scoreRunsPerGame(rpg: number): number {
  return Math.max(0, Math.min(100, 50 + (rpg - 4.5) * 12));
}

function scoreTeamKRate(kRate: number): number {
  // Lower K rate = better, league avg ~22%
  return Math.max(0, Math.min(100, 50 + (22 - kRate) * 3));
}

function scoreHomeAway(record: { wins: number; losses: number }, isHome: boolean): number {
  const total = record.wins + record.losses;
  if (total === 0) return isHome ? 55 : 45;
  const pct = record.wins / total;
  return Math.max(0, Math.min(100, pct * 100));
}

function scoreRestDays(daysSinceLastGame: number): number {
  if (daysSinceLastGame === 1) return 50; // Normal
  if (daysSinceLastGame === 0) return 35; // Doubleheader fatigue
  if (daysSinceLastGame >= 2) return 55; // Extra rest
  return 50;
}

function scoreMomentum(last5: string[]): number {
  const wins = last5.filter(r => r === "W").length;
  return Math.max(0, Math.min(100, wins * 20));
}

function scoreParkFactor(pf: number, isOver: boolean): number {
  // For O/U: higher park factor = more runs = favors over
  if (isOver) return Math.max(0, Math.min(100, pf * 50));
  return Math.max(0, Math.min(100, (2 - pf) * 50));
}

function scoreWeatherWind(windSpeed: number, windDirection: string): number {
  // Wind out = more runs, wind in = fewer
  const isOut = windDirection?.toLowerCase().includes("out") || false;
  const isIn = windDirection?.toLowerCase().includes("in") || false;
  if (isOut) return Math.min(100, 50 + windSpeed * 3);
  if (isIn) return Math.max(0, 50 - windSpeed * 3);
  return 50;
}

function scoreTemperature(temp: number): number {
  // Warmer = more runs, ball carries better
  if (temp >= 85) return 70;
  if (temp >= 75) return 60;
  if (temp >= 65) return 50;
  if (temp >= 55) return 40;
  return 30;
}

// ── Weight Tables ──
const WEIGHTS: Record<string, Record<string, number>> = {
  moneyline: {
    sp_era: 0.17, sp_whip: 0.07, sp_k9: 0.05, sp_last3_era: 0.10, bullpen_era: 0.05,
    team_ba: 0.05, team_ops: 0.05, runs_game: 0.03, lr_splits: 0.05, team_k_rate: 0.02,
    home_away: 0.08, rest_days: 0.02, momentum: 0.07,
  },
  runline: {
    sp_era: 0.10, sp_whip: 0.05, sp_k9: 0.03, sp_last3_era: 0.05, bullpen_era: 0.12,
    team_ba: 0.08, team_ops: 0.12, runs_game: 0.05, lr_splits: 0.05, team_k_rate: 0.03,
    home_away: 0.05, rest_days: 0.02, momentum: 0.05,
  },
  total: {
    sp_era: 0.15, sp_whip: 0.08, sp_k9: 0.05, sp_last3_era: 0.08, bullpen_era: 0.08,
    team_ba: 0.05, team_ops: 0.05, runs_game: 0.10, lr_splits: 0.03, team_k_rate: 0.03,
    park_factor: 0.12, weather_wind: 0.05, temperature: 0.05,
  },
};

// ── Compute Context Data ──
function computeHomeAwaySplits(events: any[], teamId: string) {
  const home = { wins: 0, losses: 0 };
  const away = { wins: 0, losses: 0 };
  for (const ev of events.slice(-40)) {
    const comp = ev.competitions?.[0];
    if (!comp || comp.status?.type?.name !== "STATUS_FINAL") continue;
    const teamComp = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
    if (!teamComp) continue;
    const won = teamComp.winner === true;
    if (teamComp.homeAway === "home") won ? home.wins++ : home.losses++;
    else won ? away.wins++ : away.losses++;
  }
  return { home, away };
}

function computeLast5(events: any[], teamId: string): string[] {
  const results: string[] = [];
  const completed = events
    .filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-5);
  for (const ev of completed) {
    const comp = ev.competitions[0];
    const tc = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
    if (tc) results.push(tc.winner ? "W" : "L");
  }
  return results;
}

function computeRestDays(events: any[], targetDate: string): number | null {
  const target = new Date(targetDate).getTime();
  const priorGames = events
    .filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL")
    .map(e => new Date(e.date).getTime())
    .filter(date => Number.isFinite(date) && date < target)
    .sort((a, b) => b - a);
  if (priorGames.length === 0) return null;
  return Math.max(0, Math.floor((target - priorGames[0]) / (1000 * 60 * 60 * 24)));
}

// ── Injury Intelligence ──
function adjustForInjuries(
  injuries: any[],
  factors: Record<string, number | null>,
  applyOffensePenalty: boolean,
): { adjustedFactors: Record<string, number | null>; warnings: string[] } {
  const warnings: string[] = [];
  const adjusted = { ...factors };
  
  const keyOut = injuries.filter(i => {
    const s = (i.status || "").toLowerCase();
    return s.includes("out") || s.includes("injured list") || s.includes("il") || s.includes("day-to-day") || s.includes("dtd");
  });
  
  const startersOut = keyOut.filter(i => i.isStarter || ["SP", "C", "SS", "CF"].includes(i.position));
  
  if (startersOut.length > 0 && applyOffensePenalty) {
    const penalty = Math.min(startersOut.length * 5, 20);
    if (Number.isFinite(adjusted.team_ops)) adjusted.team_ops = Math.max(0, Number(adjusted.team_ops) - penalty);
    if (Number.isFinite(adjusted.team_ba)) adjusted.team_ba = Math.max(0, Number(adjusted.team_ba) - penalty);
    if (Number.isFinite(adjusted.runs_game)) adjusted.runs_game = Math.max(0, Number(adjusted.runs_game) - penalty * 0.8);
  }
  if (startersOut.length > 0) {
    for (const p of startersOut) {
      warnings.push(`⚠️ ${p.name} (${p.position}) — ${p.status}: ${p.detail || "No details"}`);
    }
  }
  
  const pitchersOut = keyOut.filter(i => i.position === "SP" || i.position === "RP" || i.position === "CL");
  if (pitchersOut.length > 0 && Number.isFinite(adjusted.bullpen_era)) {
    adjusted.bullpen_era = Math.max(0, Number(adjusted.bullpen_era) - pitchersOut.length * 4);
  }
  
  return { adjustedFactors: adjusted, warnings };
}

// ── Main Analysis Engine ──
function runModel(
  betType: string,
  team1Factors: Record<string, number | null | undefined>,
  team2Factors: Record<string, number | null | undefined>,
  sharedFactors: Record<string, number | null | undefined>,
): { confidence: number; verdict: string; factorBreakdown: any[] } {
  const weights = WEIGHTS[betType] || WEIGHTS.moneyline;
  
  const factorBreakdown: any[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (const [factor, weight] of Object.entries(weights)) {
    if (weight === 0) continue;
    
    const isShared = ["park_factor", "weather_wind", "temperature"].includes(factor);
    const t1Score = team1Factors[factor];
    const t2Score = team2Factors[factor];
    const sharedScore = sharedFactors[factor];
    const available = isShared
      ? Number.isFinite(sharedScore)
      : Number.isFinite(t1Score) && Number.isFinite(t2Score);
    if (!available) {
      factorBreakdown.push({
        factor,
        label: formatFactorLabel(factor),
        weight: 0,
        configuredWeight: Math.round(weight * 100),
        available: false,
        detail: "Verified input unavailable; excluded from score",
      });
      continue;
    }
    const safe1 = Number(t1Score);
    const safe2 = Number(t2Score);
    
    // Advantage score: how much team1's factor exceeds team2's
    let advantageScore: number;
    if (isShared) {
      advantageScore = Number(sharedScore);
    } else if (betType === "total") {
      // O/U is a single game-level event — combine both teams symmetrically (order-independent)
      advantageScore = (safe1 + safe2) / 2;
    } else {
      advantageScore = 50 + (safe1 - safe2) / 2;
    }
    if (isNaN(advantageScore)) advantageScore = 50;
    advantageScore = Math.max(0, Math.min(100, advantageScore));
    
    factorBreakdown.push({
      factor,
      label: formatFactorLabel(factor),
      weight: Math.round(weight * 100),
      team1Score: Math.round(safe1),
      team2Score: Math.round(safe2),
      advantageScore: Math.round(advantageScore),
      contribution: Math.round(advantageScore * weight),
      available: true,
    });
    
    weightedSum += advantageScore * weight;
    totalWeight += weight;
  }
  
  const confidence = Math.round(totalWeight > 0 ? weightedSum / totalWeight : 50);
  
  let verdict: string;
  if (confidence >= 72) verdict = "STRONG PICK";
  else if (confidence >= 58) verdict = "LEAN";
  else if (confidence >= 42) verdict = "RISKY";
  else verdict = "FADE";
  
  return { confidence, verdict, factorBreakdown };
}

function formatFactorLabel(factor: string): string {
  const labels: Record<string, string> = {
    sp_era: "SP ERA (Season)", sp_whip: "SP WHIP", sp_k9: "SP K/9",
    sp_last3_era: "SP Last 3 ERA", bullpen_era: "Bullpen ERA",
    team_ba: "Team BA (L10)", team_ops: "Team OPS", runs_game: "Runs/Game",
    lr_splits: "L/R Splits", team_k_rate: "Team K Rate",
    home_away: "Home/Away Record", rest_days: "Rest Days", momentum: "L5 Momentum",
    park_factor: "Park Factor", weather_wind: "Wind", temperature: "Temperature",
  };
  return labels[factor] || factor;
}

// ── AI Writeup ──
async function generateWriteup(prediction: any, betType: string): Promise<string> {
  try {
    const topFactors = prediction.factorBreakdown
      .sort((a: any, b: any) => b.weight - a.weight)
      .slice(0, 5)
      .map((f: any) => `${f.label}: T1=${f.team1Score} T2=${f.team2Score} (weight ${f.weight}%)`)
      .join(", ");

    const prompt = `You are a concise MLB analyst. Given this ${betType} analysis with a non-probabilistic heuristic score of ${prediction.confidence}/100 (${prediction.verdict}), top factors: ${topFactors}. Injuries: ${(prediction.warnings || []).join("; ") || "None"}. Write exactly 2-3 data-driven sentences. Do not call the score a probability, win chance, or calibrated confidence.`;

    const result = await callAI({
      fnName: "mlb-model",
      messages: [
        { role: "system", content: `You are an expert MLB betting analyst. Be concise, data-driven, and confident. ${ANTI_GENERIC_INSTRUCTION}` },
        { role: "user", content: prompt },
      ],
      maxTokens: 200,
    });

    const raw = result.output as string;
    const clean = raw.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").replace(/\n{2,}/g, " ").trim();
    if (clean.length <= 250) return clean;
    const cut = clean.slice(0, 250);
    const lastDot = cut.lastIndexOf(".");
    return lastDot > 80 ? cut.slice(0, lastDot + 1) : cut + "…";
  } catch (e) {
    if (!(e instanceof AIProviderError)) console.error("mlb-model writeup error:", e);
    return "Analysis currently unavailable";
  }
}

// ── Supabase Client ──
function getClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── Main Handler ──
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const access = await requirePremiumAccess(req, corsHeaders);
  if (!access.ok) return access.response;
  
  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean).pop() || "";
  
  try {
    const supabase = getClient();
    
    // ─── GET /games — Today's MLB games ───
    if (path === "games" && req.method === "GET") {
      const events = await getScoreboard();
      const games = await Promise.all(events.map(async (ev: any) => {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
        const intelligence = await fetchMlbGameIntelligence({
          gameDate: ev.date,
          homeAbbr: home?.team?.abbreviation,
          awayAbbr: away?.team?.abbreviation,
          includePitchTypes: false,
        }).catch((error) => {
          console.warn(`[mlb-model] official game context unavailable event=${ev.id}:`, error);
          return null;
        });
        const weather = intelligence?.weather ?? null;
        const venue = comp?.venue?.fullName || "";
        
        return {
          id: ev.id,
          name: ev.name,
          shortName: ev.shortName,
          date: ev.date,
          status: comp?.status?.type?.name || "pre",
          venue,
          weather: weather ? {
            temperature: weather.temperatureF,
            condition: weather.condition,
            wind: weather.windDirection,
            windMph: weather.windMph,
          } : null,
          parkFactor: intelligence?.parkFactor ?? null,
          home: {
            id: home?.team?.id,
            name: home?.team?.displayName || home?.team?.name,
            abbreviation: home?.team?.abbreviation,
            logo: home?.team?.logo,
            record: home?.records?.[0]?.summary || "",
            score: home?.score,
          },
          away: {
            id: away?.team?.id,
            name: away?.team?.displayName || away?.team?.name,
            abbreviation: away?.team?.abbreviation,
            logo: away?.team?.logo,
            record: away?.records?.[0]?.summary || "",
            score: away?.score,
          },
          pitchers: {
            home: intelligence?.pitchers.home ?? null,
            away: intelligence?.pitchers.away ?? null,
          },
          dataQuality: intelligence ? { missing: intelligence.missing, source: intelligence.source } : null,
        };
      }));
      
      return json({ games, date: new Date().toISOString().split("T")[0] });
    }
    
    // ─── POST /analyze — Full 20-factor analysis ───
    if (path === "analyze" && req.method === "POST") {
      const body = await req.json();
      const { game_id, bet_type = "moneyline", team1_id, team2_id, over_under, player_name, prop_type, line, team1_is_home } = body;
      
      if (!team1_id || !team2_id) return json({ error: "team1_id and team2_id are required" }, 400);
      if (!["moneyline", "runline", "total", "player_prop"].includes(bet_type)) {
        return json({ error: "Invalid bet_type. Use: moneyline, runline, total, player_prop" }, 400);
      }
      const totalLine = bet_type === "total" ? Number(line) : null;
      const totalSide = bet_type === "total" ? String(over_under).toLowerCase() : null;
      if (bet_type === "total" && (!Number.isFinite(totalLine) || (totalLine as number) <= 0)) {
        return json({ error: "Insufficient data: a valid MLB total line is required." }, 422);
      }
      if (bet_type === "total" && !["over", "under"].includes(totalSide || "")) {
        return json({ error: "Insufficient data: choose Over or Under for the MLB total." }, 422);
      }
      
      // Totals depend on the selected line and side, which are not cache key columns.
      if (game_id && bet_type !== "total") {
        const { data: cached } = await supabase
          .from("mlb_predictions")
          .select("*")
          .eq("game_id", game_id)
          .eq("bet_type", bet_type)
          .eq("prediction_date", new Date().toISOString().split("T")[0])
          .maybeSingle();
        
        if (cached && !player_name) {
          return json(cached.prediction);
        }
      }
      
      // Fetch all data in parallel
      const [schedule1, schedule2, injuries1, injuries2] = await Promise.all([
        getTeamSchedule(team1_id),
        getTeamSchedule(team2_id),
        getTeamInjuries(team1_id),
        getTeamInjuries(team2_id),
      ]);
      
      const events = await getScoreboard();
      let eventData: any = game_id ? events.find((event: any) => String(event.id) === String(game_id)) : null;
      if (!eventData) {
        eventData = events.find((event: any) => {
          const ids = (event?.competitions?.[0]?.competitors || []).map((entry: any) => String(entry?.team?.id || entry?.id));
          return ids.includes(String(team1_id)) && ids.includes(String(team2_id));
        });
      }
      if (!eventData) return json({ error: "Verified MLB game context is unavailable for this matchup." }, 422);

      const eventComp = eventData.competitions?.[0];
      const homeComp = eventComp?.competitors?.find((entry: any) => entry.homeAway === "home");
      const awayComp = eventComp?.competitors?.find((entry: any) => entry.homeAway === "away");
      const homeId = String(homeComp?.team?.id || homeComp?.id || "");
      const awayId = String(awayComp?.team?.id || awayComp?.id || "");
      let team1IsHome: boolean;
      if (typeof team1_is_home === "boolean") team1IsHome = team1_is_home;
      else if (String(team1_id) === homeId) team1IsHome = true;
      else if (String(team1_id) === awayId) team1IsHome = false;
      else return json({ error: "Unable to resolve MLB home/away mapping." }, 422);

      let verified: MlbGameIntelligence;
      try {
        verified = await fetchMlbGameIntelligence({
          gameDate: eventData.date,
          homeAbbr: homeComp?.team?.abbreviation,
          awayAbbr: awayComp?.team?.abbreviation,
          includePitchTypes: false,
        });
      } catch (error) {
        console.error("Verified MLB context fetch failed:", error);
        return json({ error: "Official MLB pitcher, lineup, bullpen, park, or weather context could not be verified." }, 422);
      }

      const homePitcher = verified.pitchers.home;
      const awayPitcher = verified.pitchers.away;
      if (!homePitcher?.season || !awayPitcher?.season) {
        return json({ error: "Both probable starters need verified current-season pitching profiles." }, 422);
      }

      // Compute context
      const splits1 = computeHomeAwaySplits(schedule1, team1_id);
      const splits2 = computeHomeAwaySplits(schedule2, team2_id);

      // Map each team to its actual pitcher and split based on real home/away role
      const team1Pitcher = team1IsHome ? homePitcher : awayPitcher;
      const team2Pitcher = team1IsHome ? awayPitcher : homePitcher;
      const team1Official = verified.teamStats[team1IsHome ? "home" : "away"];
      const team2Official = verified.teamStats[team1IsHome ? "away" : "home"];
      const team1Lineup = verified.lineups[team1IsHome ? "home" : "away"];
      const team2Lineup = verified.lineups[team1IsHome ? "away" : "home"];
      const team1Bullpen = verified.bullpen[team1IsHome ? "home" : "away"];
      const team2Bullpen = verified.bullpen[team1IsHome ? "away" : "home"];
      const team1Split = team1IsHome ? splits1.home : splits1.away;
      const team2Split = team1IsHome ? splits2.away : splits2.home;
      const last5_1 = computeLast5(schedule1, team1_id);
      const last5_2 = computeLast5(schedule2, team2_id);
      const rest1 = computeRestDays(schedule1, verified.gameDate);
      const rest2 = computeRestDays(schedule2, verified.gameDate);
      const isOver = totalSide === "over";
      const weather = verified.weather;
      const windSpeed = weather?.windMph ?? null;
      const windDir = weather?.windDirection ?? null;
      const temp = weather?.temperatureF ?? null;
      const parkFactor = verified.parkFactor?.runFactor ?? null;
      const roofClosed = String(weather?.roofType || "").toLowerCase().includes("closed");
      if (bet_type === "player_prop") {
        return json({
          bet_type,
          confidence: null,
          score_kind: "context_only",
          probability_supported: false,
          verdict: "CONTEXT_ONLY",
          factorBreakdown: [],
          writeup: null,
          pitchers: { home: homePitcher, away: awayPitcher },
          context: {
            parkFactor: verified.parkFactor,
            weather,
            lineups: verified.lineups,
            bullpen: verified.bullpen,
            teamStats: verified.teamStats,
            missing: verified.missing,
            source: verified.source,
            fetchedAt: verified.fetchedAt,
          },
        });
      }
      const forTotal = (score: number | null, kind: "offense" | "pitching") => {
        if (score === null || !Number.isFinite(score)) return null;
        if (bet_type !== "total") return score;
        if (kind === "offense") return isOver ? score : 100 - score;
        return isOver ? 100 - score : score;
      };
      const bullpenScore = (era: number | null, freshness: number | null) => {
        if (era === null && freshness === null) return null;
        if (era === null) return freshness;
        if (freshness === null) return scoreBullpenERA(era);
        return scoreBullpenERA(era) * 0.7 + freshness * 0.3;
      };

      const splitScore = (seasonOps: number | null, splitOps: number | null) => {
        if (seasonOps === null || splitOps === null) return null;
        return Math.max(0, Math.min(100, 50 + (splitOps - seasonOps) * 150));
      };

      const factorSet = (
        pitcher: typeof team1Pitcher,
        offense: typeof team1Official,
        lineup: typeof team1Lineup,
        bullpen: typeof team1Bullpen,
        homeAwayRecord: { wins: number; losses: number },
        recentResults: string[],
        restDays: number | null,
        isHome: boolean,
      ): Record<string, number | null> => {
        const season = pitcher.season;
        const recent = pitcher.recent;
        const handedness = offense.splitVsPitcherHand;
        const offenseOps = lineup.confirmed && lineup.ops !== null ? lineup.ops : offense.ops;
        const offenseKRate = lineup.confirmed && lineup.strikeoutRate !== null
          ? lineup.strikeoutRate
          : handedness?.strikeoutRate ?? offense.strikeoutRate;
        return {
          sp_era: forTotal(scorePitcherERA(season.era), "pitching"),
          sp_whip: forTotal(scorePitcherWHIP(season.whip), "pitching"),
          sp_k9: forTotal(scorePitcherK9(season.k9), "pitching"),
          sp_last3_era: recent && recent.starts >= 2 ? forTotal(scorePitcherERA(recent.era), "pitching") : null,
          bullpen_era: forTotal(bullpenScore(offense.bullpenEra, bullpen.freshnessScore), "pitching"),
          team_ba: offense.battingAverage !== null ? forTotal(scoreTeamBA(offense.battingAverage), "offense") : null,
          team_ops: offenseOps !== null ? forTotal(scoreTeamOPS(offenseOps), "offense") : null,
          runs_game: offense.runsPerGame !== null ? forTotal(scoreRunsPerGame(offense.runsPerGame), "offense") : null,
          lr_splits: handedness ? forTotal(splitScore(offense.ops, handedness.ops), "offense") : null,
          team_k_rate: offenseKRate !== null ? forTotal(scoreTeamKRate(offenseKRate), "offense") : null,
          home_away: bet_type !== "total" && homeAwayRecord.wins + homeAwayRecord.losses > 0
            ? scoreHomeAway(homeAwayRecord, isHome)
            : null,
          rest_days: bet_type !== "total" && restDays !== null ? scoreRestDays(restDays) : null,
          momentum: bet_type !== "total" && recentResults.length === 5 ? scoreMomentum(recentResults) : null,
        };
      };

      const team1Factors = factorSet(
        team1Pitcher, team1Official, team1Lineup, team1Bullpen,
        team1Split, last5_1, rest1, team1IsHome,
      );
      const team2Factors = factorSet(
        team2Pitcher, team2Official, team2Lineup, team2Bullpen,
        team2Split, last5_2, rest2, !team1IsHome,
      );
      
      const sharedFactors: Record<string, number | null> = {
        park_factor: bet_type === "total" && parkFactor !== null ? scoreParkFactor(parkFactor, isOver) : null,
        weather_wind: bet_type === "total" && !roofClosed && windSpeed !== null && windDir
          ? (isOver ? scoreWeatherWind(windSpeed, windDir) : 100 - scoreWeatherWind(windSpeed, windDir))
          : null,
        temperature: bet_type === "total" && !roofClosed && temp !== null
          ? (isOver ? scoreTemperature(temp) : 100 - scoreTemperature(temp))
          : null,
      };

      let predicted_total: number | null = null;
      const projectionInputs: string[] = [];
      if (bet_type === "total") {
        if (team1Official.runsPerGame === null || team2Official.runsPerGame === null) {
          return json({ error: "Verified current-season runs-per-game data is required for an MLB total." }, 422);
        }
        let projectedRuns = team1Official.runsPerGame + team2Official.runsPerGame;
        projectionInputs.push("official_current_season_team_runs_per_game");
        projectedRuns += ((homePitcher.season.era - 4.20) + (awayPitcher.season.era - 4.20)) * 0.35;
        projectionInputs.push("official_probable_starter_season_era");
        const bullpenEras = [verified.teamStats.home.bullpenEra, verified.teamStats.away.bullpenEra]
          .filter((value): value is number => value !== null);
        if (bullpenEras.length === 2) {
          projectedRuns += ((bullpenEras[0] - 4.00) + (bullpenEras[1] - 4.00)) * 0.15;
          projectionInputs.push("official_relief_pitching_era");
        }
        if (parkFactor !== null) {
          projectedRuns *= parkFactor;
          projectionInputs.push("current_season_park_factor");
        }
        if (!roofClosed && temp !== null) {
          projectedRuns *= temp > 75 ? 1.03 : temp < 55 ? 0.97 : 1;
          projectionInputs.push("official_game_weather_temperature");
        }
        if (!roofClosed && windSpeed !== null && windDir) {
          const direction = windDir.toLowerCase();
          projectedRuns *= direction.includes("out")
            ? 1 + windSpeed * 0.008
            : direction.includes("in") ? 1 - windSpeed * 0.005 : 1;
          projectionInputs.push("official_game_weather_wind");
        }
        predicted_total = Math.round(projectedRuns * 10) / 10;
      }
      
      // Apply injury adjustments
      const { adjustedFactors: adj1, warnings: warn1 } = adjustForInjuries(injuries1, team1Factors, !team1Lineup.confirmed);
      const { adjustedFactors: adj2, warnings: warn2 } = adjustForInjuries(injuries2, team2Factors, !team2Lineup.confirmed);
      
      // Run model
      const result = runModel(bet_type, adj1, adj2, sharedFactors);

      let finalConfidence = result.confidence;
      let finalVerdict = result.verdict;
      if (bet_type === "total" && predicted_total != null && totalLine != null) {
        const diff = predicted_total - totalLine;
        const overHeuristicScore = Math.max(10, Math.min(90, Math.round(50 + diff * 8)));
        finalConfidence = totalSide === "over" ? overHeuristicScore : 100 - overHeuristicScore;
        if (Math.abs(diff) <= 0.3) finalVerdict = "PASS";
        else if (finalConfidence >= 72) finalVerdict = `STRONG ${String(totalSide).toUpperCase()}`;
        else if (finalConfidence >= 58) finalVerdict = `LEAN ${String(totalSide).toUpperCase()}`;
        else if (finalConfidence >= 42) finalVerdict = "RISKY";
        else finalVerdict = `FADE ${String(totalSide).toUpperCase()}`;
        console.info(
          `[mlb-model][total] result side=${over_under} line=${totalLine} projection=${predicted_total} heuristic_score=${finalConfidence} verdict=${finalVerdict}`,
        );
      }

      // Generate AI writeup
      const writeup = await generateWriteup({ ...result, confidence: finalConfidence, verdict: finalVerdict, warnings: [...warn1, ...warn2] }, bet_type);
      
      const prediction = {
        bet_type,
        confidence: finalConfidence,
        score_kind: "heuristic_score",
        probability_supported: false,
        verdict: finalVerdict,
        predicted_total,
        factorBreakdown: result.factorBreakdown,
        writeup,
        injuries: {
          team1: injuries1,
          team2: injuries2,
          warnings: [...warn1, ...warn2],
        },
        pitchers: {
          home: homePitcher,
          away: awayPitcher,
        },
        context: {
          parkFactor,
          weather,
          lineups: verified.lineups,
          bullpen: verified.bullpen,
          momentum: { team1: last5_1, team2: last5_2 },
          splits: { team1: splits1, team2: splits2 },
          projectionInputs,
          missing: verified.missing,
          source: verified.source,
          fetchedAt: verified.fetchedAt,
        },
      };
      
      // Cache prediction
      if (game_id && !player_name && bet_type !== "total") {
        try {
          await supabase.from("mlb_predictions").insert({
            game_id: String(game_id),
            bet_type,
            prediction,
            confidence: finalConfidence,
            verdict: finalVerdict,
            prediction_date: new Date().toISOString().split("T")[0],
          });
        } catch (_) { /* cache miss is fine */ }
      }

      // Snapshot logging — fire and forget
      logSnapshot({
        sport: "mlb",
        market_type: bet_type,
        player_or_team: player_name || `${team1_id} vs ${team2_id}`,
        prop_type: prop_type || null,
        line: typeof line === "string" ? parseFloat(line) : (line ?? null),
        direction: over_under || null,
        confidence: finalConfidence,
        verdict: finalVerdict,
        top_factors: (result.factorBreakdown || []).slice(0, 5),
      }).catch((err) => console.error("logSnapshot failed:", err));

      return json(prediction);
    }
    
    return json({ error: "Not found. Use GET /games or POST /analyze" }, 404);
    
  } catch (e: any) {
    console.error("mlb-model error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
