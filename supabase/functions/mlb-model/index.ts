import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token, x-device-fingerprint, x-request-timestamp, x-request-nonce, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

// ── Park Factors (2024 reference) ──
const PARK_FACTORS: Record<string, number> = {
  "Coors Field": 1.39, "Globe Life Field": 1.12, "Great American Ball Park": 1.11,
  "Fenway Park": 1.09, "Guaranteed Rate Field": 1.08, "Wrigley Field": 1.06,
  "Citizens Bank Park": 1.05, "Yankee Stadium": 1.04, "Citi Field": 1.02,
  "Tropicana Field": 1.01, "Chase Field": 1.01, "Target Field": 1.00,
  "Minute Maid Park": 0.99, "Dodger Stadium": 0.98, "Busch Stadium": 0.97,
  "Progressive Field": 0.97, "Camden Yards": 0.97, "American Family Field": 0.96,
  "PNC Park": 0.95, "Angel Stadium": 0.95, "Kauffman Stadium": 0.94,
  "T-Mobile Park": 0.93, "Rogers Centre": 0.93, "loanDepot park": 0.92,
  "Truist Park": 0.91, "Petco Park": 0.90, "Nationals Park": 0.95,
  "Comerica Park": 0.93, "Oracle Park": 0.83, "Oakland Coliseum": 0.90,
};

function getParkFactor(venueName: string): number {
  for (const [k, v] of Object.entries(PARK_FACTORS)) {
    if (venueName.toLowerCase().includes(k.toLowerCase().split(" ")[0])) return v;
  }
  return 1.0;
}

// ── Data Fetching ──
async function getScoreboard() {
  const data = await fetchJSON(`${ESPN_MLB}/scoreboard`);
  return data.events || [];
}

async function getTeamStats(teamId: string): Promise<Record<string, any>> {
  try {
    const data = await fetchJSON(`${ESPN_MLB}/teams/${teamId}/statistics`);
    const stats: Record<string, any> = {};
    for (const cat of data.splits?.categories || []) {
      for (const s of cat.stats || []) {
        stats[s.name] = parseFloat(s.value) || 0;
      }
    }
    return stats;
  } catch { return {}; }
}

async function getTeamSchedule(teamId: string): Promise<any[]> {
  try {
    const data = await fetchJSON(`${ESPN_MLB}/teams/${teamId}/schedule`);
    return data.events || [];
  } catch { return []; }
}

async function getTeamInjuries(teamId: string): Promise<any[]> {
  try {
    const data = await fetchJSON(`${ESPN_MLB}/teams/${teamId}/injuries`);
    return (data.items || []).map((item: any) => ({
      name: item.athlete?.displayName || "Unknown",
      position: item.athlete?.position?.abbreviation || "",
      status: item.status || "Unknown",
      detail: item.longComment || item.shortComment || "",
      isStarter: ["SP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"].includes(item.athlete?.position?.abbreviation || ""),
    }));
  } catch { return []; }
}

async function getStartingPitcherStats(event: any): Promise<{ home: any; away: any }> {
  const result = { home: null as any, away: null as any };
  try {
    for (const comp of event.competitions?.[0]?.competitors || []) {
      const side = comp.homeAway === "home" ? "home" : "away";
      const pitcher = comp.probables?.[0] || null;
      if (pitcher) {
        let stats: Record<string, number> = {};
        let throwingHand = "right";
        try {
          const pData = await fetchJSON(`${ESPN_MLB}/teams/${comp.team.id}/roster`);
          const athlete = (pData.athletes || []).flat().find((a: any) => 
            a.id === pitcher.athlete?.id || a.displayName === pitcher.athlete?.displayName
          );
          if (athlete?.statistics) {
            for (const s of athlete.statistics) {
              stats[s.name] = parseFloat(s.value) || 0;
            }
          }
          // Detect throwing hand from athlete data
          if (athlete?.hand?.abbreviation) {
            throwingHand = athlete.hand.abbreviation.toLowerCase() === "l" ? "left" : "right";
          } else if (athlete?.displayName) {
            // Fallback: check if name/position contains L or LHP
            const pos = (athlete.position?.abbreviation || "").toLowerCase();
            if (pos.includes("lhp") || pos.includes("l")) throwingHand = "left";
          }
        } catch {}
        
        // Fallback to pitcher summary stats
        const summary = pitcher.statistics || [];
        for (const s of summary) {
          if (s.name && s.value !== undefined) stats[s.name] = parseFloat(s.value) || 0;
        }

        const era = stats.ERA || stats.era || 4.50;
        const whip = stats.WHIP || stats.whip || 1.30;
        const k9 = stats["K/9"] || stats.strikeoutsPerNineInnings || 8.0;

        // Compute SP last 3 starts approximation from ERA variance
        // A pitcher trending well will have lower recent ERA; trending poorly, higher
        const gamesStarted = stats.gamesStarted || stats.GS || 10;
        const recentEraFactor = gamesStarted > 5 ? 0.92 : 1.0; // Early season: less regression
        const last3Era = era * recentEraFactor;
        
        result[side] = {
          name: pitcher.athlete?.displayName || "TBD",
          id: pitcher.athlete?.id || null,
          stats,
          era,
          whip,
          k9,
          last3Era,
          throwingHand,
          gamesStarted,
        };
      }
    }
  } catch (e) { console.error("SP fetch error:", e); }
  return result;
}

// ── Odds API Integration ──
async function getOddsForGame(supabase: any, gameTeams: { home: string; away: string }) {
  try {
    const keyData = await supabase
      .from("odds_api_keys")
      .select("api_key")
      .eq("is_active", true)
      .is("exhausted_at", null)
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .single();
    
    const apiKey = keyData?.data?.api_key || Deno.env.get("ODDS_API_KEY");
    if (!apiKey) return null;
    
    const resp = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
    );
    if (!resp.ok) return null;
    const events = await resp.json();
    
    // Find matching game
    const matchEvent = events.find((e: any) => {
      const ht = e.home_team?.toLowerCase() || "";
      const at = e.away_team?.toLowerCase() || "";
      return ht.includes(gameTeams.home.toLowerCase().split(" ").pop()) ||
             at.includes(gameTeams.away.toLowerCase().split(" ").pop());
    });
    
    if (!matchEvent) return null;
    
    // Extract consensus odds
    const odds: Record<string, any> = { raw: matchEvent.bookmakers };
    for (const bm of matchEvent.bookmakers || []) {
      for (const mkt of bm.markets || []) {
        if (!odds[mkt.key]) odds[mkt.key] = [];
        odds[mkt.key].push(...mkt.outcomes.map((o: any) => ({ ...o, book: bm.title })));
      }
    }
    return odds;
  } catch { return null; }
}

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
  if (!rpg || isNaN(rpg)) return 50;
  return Math.max(0, Math.min(100, 50 + (rpg - 4.5) * 12));
}

function scoreLRSplits(pitcherHand: string, lineupHandedness: string): number {
  // Advantage when lineup has opposite hand to pitcher
  if (lineupHandedness === "mixed") {
    return pitcherHand === "left" ? 58 : 53; // Slight edge vs lefties (less common)
  }
  if ((lineupHandedness === "right" && pitcherHand === "left") ||
      (lineupHandedness === "left" && pitcherHand === "right")) return 65;
  return 40;
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

function scoreDayNight(isDayGame: boolean, teamDayRecord?: { w: number; l: number }): number {
  if (!teamDayRecord || (teamDayRecord.w + teamDayRecord.l) === 0) return 50;
  return Math.max(0, Math.min(100, (teamDayRecord.w / (teamDayRecord.w + teamDayRecord.l)) * 100));
}

function scoreMomentum(last5: string[]): number {
  const wins = last5.filter(r => r === "W").length;
  return Math.max(0, Math.min(100, wins * 20));
}

function scoreRunDifferential(diff: number, gamesPlayed: number): number {
  if (gamesPlayed === 0) return 50;
  const perGame = diff / gamesPlayed;
  return Math.max(0, Math.min(100, 50 + perGame * 12));
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

function scoreLineMovement(openOdds: number, currentOdds: number): number {
  // Movement toward the pick = sharp action
  const shift = currentOdds - openOdds;
  return Math.max(0, Math.min(100, 50 + shift * 0.5));
}

function scorePublicPercent(lineMovementMagnitude: number): number {
  // Approximate: if line moves against public, sharp money
  return Math.max(0, Math.min(100, 50 + lineMovementMagnitude * 2));
}

// ── Weight Tables ──
const WEIGHTS: Record<string, Record<string, number>> = {
  moneyline: {
    sp_era: 0.17, sp_whip: 0.07, sp_k9: 0.05, sp_last3_era: 0.10, bullpen_era: 0.05,
    team_ba: 0.05, team_ops: 0.05, runs_game: 0.03, lr_splits: 0.05, team_k_rate: 0.02,
    home_away: 0.08, rest_days: 0.02, day_night: 0.02, momentum: 0.07, run_diff: 0.05,
    park_factor: 0.02, weather_wind: 0.02, temperature: 0.02, line_movement: 0.04, public_pct: 0.02,
  },
  runline: {
    sp_era: 0.10, sp_whip: 0.05, sp_k9: 0.03, sp_last3_era: 0.05, bullpen_era: 0.12,
    team_ba: 0.08, team_ops: 0.12, runs_game: 0.05, lr_splits: 0.05, team_k_rate: 0.03,
    home_away: 0.05, rest_days: 0.02, day_night: 0.02, momentum: 0.05, run_diff: 0.08,
    park_factor: 0.03, weather_wind: 0.02, temperature: 0.02, line_movement: 0.02, public_pct: 0.01,
  },
  total: {
    sp_era: 0.15, sp_whip: 0.08, sp_k9: 0.05, sp_last3_era: 0.08, bullpen_era: 0.08,
    team_ba: 0.05, team_ops: 0.05, runs_game: 0.10, lr_splits: 0.03, team_k_rate: 0.03,
    home_away: 0.03, rest_days: 0.02, day_night: 0.02, momentum: 0.03, run_diff: 0.03,
    park_factor: 0.12, weather_wind: 0.05, temperature: 0.05, line_movement: 0.02, public_pct: 0.02,
  },
  player_prop: {
    sp_era: 0.05, sp_whip: 0, sp_k9: 0.15, sp_last3_era: 0.05, bullpen_era: 0,
    team_ba: 0.10, team_ops: 0.10, runs_game: 0, lr_splits: 0.15, team_k_rate: 0.10,
    home_away: 0.05, rest_days: 0, day_night: 0.05, momentum: 0.05, run_diff: 0,
    park_factor: 0.05, weather_wind: 0.05, temperature: 0.05, line_movement: 0, public_pct: 0,
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
  const completed = events.filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").slice(-5);
  for (const ev of completed) {
    const comp = ev.competitions[0];
    const tc = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
    if (tc) results.push(tc.winner ? "W" : "L");
  }
  return results;
}

function computeRestDays(events: any[]): number {
  const completed = events.filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL");
  if (completed.length === 0) return 1;
  const lastDate = new Date(completed[completed.length - 1].date);
  const now = new Date();
  return Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
}

function computeRunDifferential(stats: Record<string, any>): { diff: number; games: number } {
  const runsScored = stats.runs || stats.runsScored || 0;
  const runsAllowed = stats.runsAllowed || stats.earnedRuns || 0;
  const games = stats.gamesPlayed || stats.games || 1;
  return { diff: runsScored - runsAllowed, games };
}

// ── Injury Intelligence ──
function adjustForInjuries(injuries: any[], factors: Record<string, number>): { adjustedFactors: Record<string, number>; warnings: string[] } {
  const warnings: string[] = [];
  const adjusted = { ...factors };
  
  const keyOut = injuries.filter(i => {
    const s = (i.status || "").toLowerCase();
    return s.includes("out") || s.includes("injured list") || s.includes("il") || s.includes("day-to-day") || s.includes("dtd");
  });
  
  const startersOut = keyOut.filter(i => i.isStarter || ["SP", "C", "SS", "CF"].includes(i.position));
  
  if (startersOut.length > 0) {
    const penalty = Math.min(startersOut.length * 5, 20);
    adjusted.team_ops = Math.max(0, (adjusted.team_ops || 50) - penalty);
    adjusted.team_ba = Math.max(0, (adjusted.team_ba || 50) - penalty);
    adjusted.runs_game = Math.max(0, (adjusted.runs_game || 50) - penalty * 0.8);
    
    for (const p of startersOut) {
      warnings.push(`⚠️ ${p.name} (${p.position}) — ${p.status}: ${p.detail || "No details"}`);
    }
  }
  
  const pitchersOut = keyOut.filter(i => i.position === "SP" || i.position === "RP" || i.position === "CL");
  if (pitchersOut.length > 0) {
    adjusted.bullpen_era = Math.max(0, (adjusted.bullpen_era || 50) - pitchersOut.length * 4);
  }
  
  return { adjustedFactors: adjusted, warnings };
}

// ── Main Analysis Engine ──
function runModel(
  betType: string,
  team1Factors: Record<string, number>,
  team2Factors: Record<string, number>,
  sharedFactors: Record<string, number>,
): { confidence: number; verdict: string; factorBreakdown: any[] } {
  const weights = WEIGHTS[betType] || WEIGHTS.moneyline;
  
  const factorBreakdown: any[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  
  for (const [factor, weight] of Object.entries(weights)) {
    if (weight === 0) continue;
    
    // For team-specific factors, use the advantage of team1 over team2
    const t1Score = team1Factors[factor] ?? sharedFactors[factor] ?? 50;
    const t2Score = team2Factors[factor] ?? 50;
    
    // Guard against NaN
    const safe1 = isNaN(t1Score) ? 50 : t1Score;
    const safe2 = isNaN(t2Score) ? 50 : t2Score;
    
    // Advantage score: how much team1's factor exceeds team2's
    let advantageScore: number;
    if (["park_factor", "weather_wind", "temperature", "line_movement", "public_pct"].includes(factor)) {
      advantageScore = sharedFactors[factor] ?? 50;
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
    home_away: "Home/Away Record", rest_days: "Rest Days", day_night: "Day/Night",
    momentum: "L5 Momentum", run_diff: "Run Differential",
    park_factor: "Park Factor", weather_wind: "Wind", temperature: "Temperature",
    line_movement: "Line Movement", public_pct: "Sharp Money",
  };
  return labels[factor] || factor;
}

// ── AI Writeup ──
async function generateWriteup(prediction: any, betType: string): Promise<string> {
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return "";
    
    const topFactors = prediction.factorBreakdown
      .sort((a: any, b: any) => b.weight - a.weight)
      .slice(0, 5)
      .map((f: any) => `${f.label}: T1=${f.team1Score} T2=${f.team2Score} (weight ${f.weight}%)`)
      .join(", ");
    
     const prompt = betType === "player_prop"
       ? `You are a concise MLB analyst. The relevant team matchup factors are: ${topFactors}. Injuries: ${(prediction.warnings || []).join("; ") || "None"}. Write 2-3 sentences about how the team matchup context (pitchers, park, weather) affects this player prop. Do NOT state a confidence percentage or verdict.`
       : `You are a concise MLB analyst. Given this ${betType} prediction with ${prediction.confidence}% confidence (${prediction.verdict}), top factors: ${topFactors}. Injuries: ${(prediction.warnings || []).join("; ") || "None"}. Write exactly 2-3 sentences of sharp analysis. No hedging. Be direct.`;
    
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert MLB betting analyst. Be concise, data-driven, and confident." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
      }),
    });
    
    if (!resp.ok) return "";
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").replace(/\n{2,}/g, " ").trim();
    if (clean.length <= 250) return clean;
    const cut = clean.slice(0, 250);
    const lastDot = cut.lastIndexOf(".");
    return lastDot > 80 ? cut.slice(0, lastDot + 1) : cut + "…";
  } catch { return ""; }
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
        const pitchers = await getStartingPitcherStats(ev);
        
        const weather = comp?.weather || null;
        const venue = comp?.venue?.fullName || "";
        
        return {
          id: ev.id,
          name: ev.name,
          shortName: ev.shortName,
          date: ev.date,
          status: comp?.status?.type?.name || "pre",
          venue,
          weather: weather ? {
            temperature: weather.temperature || null,
            condition: weather.displayValue || weather.conditionId || "",
            wind: weather.wind || null,
          } : null,
          parkFactor: getParkFactor(venue),
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
            home: pitchers.home || { name: "TBD", era: 0, whip: 0, k9: 0 },
            away: pitchers.away || { name: "TBD", era: 0, whip: 0, k9: 0 },
          },
        };
      }));
      
      return json({ games, date: new Date().toISOString().split("T")[0] });
    }
    
    // ─── POST /analyze — Full 20-factor analysis ───
    if (path === "analyze" && req.method === "POST") {
      const body = await req.json();
      const { game_id, bet_type = "moneyline", team1_id, team2_id, over_under, player_name, prop_type, line } = body;
      
      if (!team1_id || !team2_id) return json({ error: "team1_id and team2_id are required" }, 400);
      if (!["moneyline", "runline", "total", "player_prop"].includes(bet_type)) {
        return json({ error: "Invalid bet_type. Use: moneyline, runline, total, player_prop" }, 400);
      }
      
      // Check cache
      if (game_id) {
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
      const [stats1, stats2, schedule1, schedule2, injuries1, injuries2] = await Promise.all([
        getTeamStats(team1_id),
        getTeamStats(team2_id),
        getTeamSchedule(team1_id),
        getTeamSchedule(team2_id),
        getTeamInjuries(team1_id),
        getTeamInjuries(team2_id),
      ]);
      
      // Fetch game-specific data
      let eventData: any = null;
      let pitchers = { home: null as any, away: null as any };
      let weather: any = null;
      let parkFactor = 1.0;
      
      if (game_id) {
        const events = await getScoreboard();
        eventData = events.find((e: any) => String(e.id) === String(game_id));
        if (eventData) {
          pitchers = await getStartingPitcherStats(eventData);
          const comp = eventData.competitions?.[0];
          weather = comp?.weather || null;
          parkFactor = getParkFactor(comp?.venue?.fullName || "");
        }
      }
      
      const homePitcher = pitchers.home || { era: 4.50, whip: 1.30, k9: 8.0 };
      const awayPitcher = pitchers.away || { era: 4.50, whip: 1.30, k9: 8.0 };

      // Determine actual home/away from game data, not input order (order-independent)
      let team1IsHome = true;
      if (eventData) {
        const comp = eventData.competitions?.[0];
        const homeComp = comp?.competitors?.find((c: any) => c.homeAway === "home");
        const awayComp = comp?.competitors?.find((c: any) => c.homeAway === "away");
        const homeId = String(homeComp?.team?.id || homeComp?.id || "");
        const awayId = String(awayComp?.team?.id || awayComp?.id || "");
        if (homeId && String(team1_id) === homeId) team1IsHome = true;
        else if (awayId && String(team1_id) === awayId) team1IsHome = false;
      }

      // Compute context
      const splits1 = computeHomeAwaySplits(schedule1, team1_id);
      const splits2 = computeHomeAwaySplits(schedule2, team2_id);

      // Map each team to its actual pitcher and split based on real home/away role
      const team1Pitcher = team1IsHome ? homePitcher : awayPitcher;
      const team2Pitcher = team1IsHome ? awayPitcher : homePitcher;
      const team1Split = team1IsHome ? splits1.home : splits1.away;
      const team2Split = team1IsHome ? splits2.away : splits2.home;
      const last5_1 = computeLast5(schedule1, team1_id);
      const last5_2 = computeLast5(schedule2, team2_id);
      const rest1 = computeRestDays(schedule1);
      const rest2 = computeRestDays(schedule2);
      const rd1 = computeRunDifferential(stats1);
      const rd2 = computeRunDifferential(stats2);
      
      const isDayGame = eventData ? new Date(eventData.date).getHours() < 17 : false;
      const isOver = over_under === "over";
      const windSpeed = weather?.wind?.speed || 0;
      const windDir = weather?.wind?.direction || "";
      const temp = weather?.temperature || 72;

      // Compute last 10 games batting average from schedule
      function computeL10BA(events: any[], teamId: string): number {
        const completed = events.filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").slice(-10);
        let totalHits = 0, totalAB = 0;
        for (const ev of completed) {
          const comp = ev.competitions?.[0];
          const tc = comp?.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
          if (tc) {
            // Use score as proxy for offensive output (hits correlate with runs)
            const score = parseInt(tc.score?.value ?? tc.score) || 0;
            totalHits += score; // Approximate
            totalAB += 9; // ~9 innings
          }
        }
        if (totalAB === 0) return 0.248;
        // Normalize: ~4.5 runs per game ≈ .248 BA avg
        const estBA = Math.min(0.350, Math.max(0.180, 0.200 + (totalHits / completed.length - 3.5) * 0.015));
        return estBA;
      }

      const l10ba1 = computeL10BA(schedule1, team1_id);
      const l10ba2 = computeL10BA(schedule2, team2_id);

      // Graduated season blending for team stats
      const completedGames1 = schedule1.filter((e: any) => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").length;
      const completedGames2 = schedule2.filter((e: any) => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").length;
      const avgGamesPlayed = (completedGames1 + completedGames2) / 2;
      const seasonWeight = Math.min(0.95, 0.30 + (avgGamesPlayed / 120));
      // Log season blend
      console.log(`📊 Season blend: ${Math.round(seasonWeight * 100)}% 2025 (${Math.round(avgGamesPlayed)}G avg) / ${Math.round((1 - seasonWeight) * 100)}% historical`);
      
      // Score all 20 factors for team1 — pitcher/split assignment based on actual home/away role
      const team1Factors: Record<string, number> = {
        sp_era: scorePitcherERA(team1Pitcher.era),
        sp_whip: scorePitcherWHIP(team1Pitcher.whip),
        sp_k9: scorePitcherK9(team1Pitcher.k9),
        sp_last3_era: scorePitcherERA(team1Pitcher.last3Era || team1Pitcher.era * 0.95),
        bullpen_era: scoreBullpenERA(stats1.reliefERA || stats1.bullpenERA || stats1.ERA || 4.00),
        team_ba: scoreTeamBA(seasonWeight > 0.5 ? l10ba1 : (stats1.battingAverage || stats1.avg || 0.248)),
        team_ops: scoreTeamOPS(stats1.OPS || stats1.ops || 0.710),
        runs_game: scoreRunsPerGame(stats1.runsPerGame || (stats1.runs / Math.max(stats1.gamesPlayed || 1, 1))),
        lr_splits: scoreLRSplits(team2Pitcher.throwingHand || "right", "mixed"),
        team_k_rate: scoreTeamKRate(stats1.strikeoutRate || stats1.strikeouts || 22),
        home_away: scoreHomeAway(team1Split, team1IsHome),
        rest_days: scoreRestDays(rest1),
        day_night: scoreDayNight(isDayGame),
        momentum: scoreMomentum(last5_1),
        run_diff: scoreRunDifferential(rd1.diff, rd1.games),
      };
      
      // Score all 20 factors for team2 — pitcher/split assignment based on actual home/away role
      const team2Factors: Record<string, number> = {
        sp_era: scorePitcherERA(team2Pitcher.era),
        sp_whip: scorePitcherWHIP(team2Pitcher.whip),
        sp_k9: scorePitcherK9(team2Pitcher.k9),
        sp_last3_era: scorePitcherERA(team2Pitcher.last3Era || team2Pitcher.era * 0.95),
        bullpen_era: scoreBullpenERA(stats2.reliefERA || stats2.bullpenERA || stats2.ERA || 4.00),
        team_ba: scoreTeamBA(seasonWeight > 0.5 ? l10ba2 : (stats2.battingAverage || stats2.avg || 0.248)),
        team_ops: scoreTeamOPS(stats2.OPS || stats2.ops || 0.710),
        runs_game: scoreRunsPerGame(stats2.runsPerGame || (stats2.runs / Math.max(stats2.gamesPlayed || 1, 1))),
        lr_splits: scoreLRSplits(team1Pitcher.throwingHand || "right", "mixed"),
        team_k_rate: scoreTeamKRate(stats2.strikeoutRate || stats2.strikeouts || 22),
        home_away: scoreHomeAway(team2Split, !team1IsHome),
        rest_days: scoreRestDays(rest2),
        day_night: scoreDayNight(isDayGame),
        momentum: scoreMomentum(last5_2),
        run_diff: scoreRunDifferential(rd2.diff, rd2.games),
      };
      
      // Shared/environmental factors
      const sharedFactors: Record<string, number> = {
        park_factor: scoreParkFactor(parkFactor, isOver),
        weather_wind: scoreWeatherWind(windSpeed, windDir),
        temperature: scoreTemperature(temp),
        line_movement: 50,
        public_pct: 50,
      };
      
      // Enhanced: Compute line movement from odds data
      if (game_id && eventData) {
        const odds = await getOddsForGame(supabase, {
          home: eventData.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "home")?.team?.displayName || "",
          away: eventData.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "away")?.team?.displayName || "",
        });
        if (odds) {
          const h2hOdds = odds.h2h || [];
          if (h2hOdds.length > 1) {
            const prices = h2hOdds.map((o: any) => o.price || 0).filter((p: number) => p !== 0);
            if (prices.length >= 2) {
              const spread = Math.max(...prices) - Math.min(...prices);
              // Bigger spread across books = more line movement = sharp action signal
              sharedFactors.line_movement = Math.min(80, 50 + spread * 0.3);
              sharedFactors.public_pct = scorePublicPercent(spread * 0.15);
            }
          }

        }
      }

      // Compute predicted total for O/U (order-independent: uses symmetric inputs only)
      let predicted_total: number | null = null;
      if (bet_type === "total") {
        const eraH = homePitcher.era || 4.50;
        const eraA = awayPitcher.era || 4.50;
        const avgERA = (eraH + eraA) / 2;
        const baseRuns = 9.0;
        const projectedRuns = baseRuns * (avgERA / 4.20) * parkFactor;
        const tempAdj = temp > 75 ? 1.03 : temp < 55 ? 0.97 : 1.0;
        const windAdj = windDir?.toLowerCase().includes("out") ? 1 + windSpeed * 0.008 : windDir?.toLowerCase().includes("in") ? 1 - windSpeed * 0.005 : 1.0;
        predicted_total = Math.round(projectedRuns * tempAdj * windAdj * 10) / 10;
        console.log(`⚾ Pitcher-adjusted total projection: ${predicted_total} runs (ERA avg ${avgERA.toFixed(2)}, PF ${parkFactor})`);
      }
      
      // Apply injury adjustments
      const { adjustedFactors: adj1, warnings: warn1 } = adjustForInjuries(injuries1, team1Factors);
      const { adjustedFactors: adj2, warnings: warn2 } = adjustForInjuries(injuries2, team2Factors);
      
      // Block player prop for injured/out players
      if (bet_type === "player_prop" && player_name) {
        const allInjured = [...injuries1, ...injuries2];
        const playerInjury = allInjured.find(i => 
          i.name.toLowerCase().includes(player_name.toLowerCase())
        );
        if (playerInjury) {
          const s = (playerInjury.status || "").toLowerCase();
          if (s.includes("out") || s.includes("injured list") || s.includes("il")) {
            return json({
              error: `Cannot generate prediction: ${player_name} is ${playerInjury.status}`,
              blocked: true,
              injury: playerInjury,
            }, 400);
          }
        }
      }
      
      // Run model
      const result = runModel(bet_type, adj1, adj2, sharedFactors);

      // Override verdict/confidence for totals using predicted_total vs line (order-independent)
      let finalConfidence = result.confidence;
      let finalVerdict = result.verdict;
      if (bet_type === "total" && predicted_total != null && line != null) {
        const lineNum = typeof line === "string" ? parseFloat(line) : line;
        if (!isNaN(lineNum)) {
          const diff = predicted_total - lineNum;
          if (diff > 0.3) finalVerdict = "OVER";
          else if (diff < -0.3) finalVerdict = "UNDER";
          else finalVerdict = "PASS";
          finalConfidence = Math.max(50, Math.min(90, Math.round(50 + Math.abs(diff) * 8)));
        }
      }

      // Generate AI writeup
      const writeup = await generateWriteup({ ...result, confidence: finalConfidence, verdict: finalVerdict, warnings: [...warn1, ...warn2] }, bet_type);
      
      const prediction = {
        bet_type,
        confidence: finalConfidence,
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
          weather: weather ? { temp, windSpeed, windDir, condition: weather.displayValue || "" } : null,
          momentum: { team1: last5_1, team2: last5_2 },
          splits: { team1: splits1, team2: splits2 },
        },
      };
      
      // Cache prediction
      if (game_id && !player_name) {
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
