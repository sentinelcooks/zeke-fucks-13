import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { callAI, AIProviderError, ANTI_GENERIC_INSTRUCTION } from "../_shared/ai-provider.ts";
import { WEIGHTS_V2, FACTOR_LABELS, MODEL_VERSION } from "./weights.ts";
import {
  computeXGProxy, scoreXG,
  computeCFProxy, scoreCFProxy,
  computePace, scorePace,
} from "../_shared/advanced_stats.ts";
import {
  pullOddsHistory, computeLineMovement, scoreLineMovement19,
  computeRLM, scoreRLM20, sharpBookDivergence,
} from "../_shared/odds_intelligence.ts";
import { nhlInjuryAdjustments, type NHLInjuryWarning } from "../_shared/injuries.ts";

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
const ESPN_NHL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

async function fetchJSON(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`ESPN ${r.status}: ${url}`);
  return r.json();
}

// ── Arena Factors (home ice advantage varies by venue) ──
const ARENA_FACTORS: Record<string, number> = {
  "TD Garden": 1.08, "Bell Centre": 1.10, "Scotiabank Arena": 1.06,
  "Madison Square Garden": 1.07, "United Center": 1.05, "Rogers Arena": 1.04,
  "Enterprise Center": 1.05, "Amalie Arena": 1.03, "T-Mobile Arena": 1.02,
  "Ball Arena": 1.06, "PPG Paints Arena": 1.05, "PNC Arena": 1.04,
  "Bridgestone Arena": 1.04, "Nationwide Arena": 1.03, "Climate Pledge Arena": 1.03,
  "Canada Life Centre": 1.05, "Canadian Tire Centre": 1.04, "KeyBank Center": 1.03,
  "Little Caesars Arena": 1.02, "UBS Arena": 1.02, "Prudential Center": 1.03,
  "Wells Fargo Center": 1.05, "SAP Center": 1.02, "Honda Center": 1.02,
  "Crypto.com Arena": 1.04, "Xcel Energy Center": 1.06, "Rogers Place": 1.05,
  "Lenovo Center": 1.03, "Mullett Arena": 1.01, "Amerant Bank Arena": 1.03,
  "Capital One Arena": 1.04, "FLA Live Arena": 1.03, "Delta Center": 1.03,
};

function getArenaFactor(venueName: string): number {
  for (const [k, v] of Object.entries(ARENA_FACTORS)) {
    if (venueName.toLowerCase().includes(k.toLowerCase().split(" ")[0])) return v;
  }
  return 1.03; // NHL average home-ice factor
}

// ── Data Fetching ──
async function getScoreboard() {
  const data = await fetchJSON(`${ESPN_NHL}/scoreboard`);
  return data.events || [];
}

async function getTeamStats(teamId: string): Promise<Record<string, any>> {
  try {
    const data = await fetchJSON(`${ESPN_NHL}/teams/${teamId}/statistics`);
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
    const data = await fetchJSON(`${ESPN_NHL}/teams/${teamId}/schedule`);
    return data.events || [];
  } catch { return []; }
}

// Single source of truth — see _shared/injuries.ts
import { fetchTeamInjuries } from "../_shared/injuries.ts";

async function getTeamInjuries(teamId: string): Promise<any[]> {
  const list = await fetchTeamInjuries("nhl", { id: teamId });
  // Add NHL-specific position flags
  return list.map((i) => ({
    ...i,
    isGoalie: ["G"].includes(i.position || ""),
    isKey: ["G", "C", "LW", "RW", "D"].includes(i.position || ""),
  }));
}

async function getStartingGoalieInfo(event: any): Promise<{ home: any; away: any }> {
  const result = { home: null as any, away: null as any };
  try {
    for (const comp of event.competitions?.[0]?.competitors || []) {
      const side = comp.homeAway === "home" ? "home" : "away";
      // Try to get goalie from roster/probables
      let goalie: any = null;
      try {
        const rosterData = await fetchJSON(`${ESPN_NHL}/teams/${comp.team.id}/roster`);
        const goalies = (rosterData.athletes || [])
          .flat()
          .filter((a: any) => a.position?.abbreviation === "G");
        // Pick the first goalie as likely starter (ESPN doesn't always confirm)
        if (goalies.length > 0) {
          goalie = goalies[0];
          // If there are stats, parse them
          const stats: Record<string, number> = {};
          for (const s of goalie.statistics || []) {
            stats[s.name] = parseFloat(s.value) || 0;
          }
          result[side] = {
            name: goalie.displayName || "TBD",
            id: goalie.id || null,
            savePct: stats.savePct || stats.savePercentage || 0.908,
            gaa: stats.goalsAgainstAverage || stats.GAA || stats.gaa || 2.90,
            wins: stats.wins || 0,
            losses: stats.losses || 0,
            stats,
          };
        }
      } catch {}
      if (!result[side]) {
        result[side] = { name: "TBD", savePct: 0.908, gaa: 2.90, wins: 0, losses: 0, stats: {} };
      }
    }
  } catch (e) { console.error("Goalie fetch error:", e); }
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
      `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`
    );
    if (!resp.ok) return null;
    const events = await resp.json();

    const matchEvent = events.find((e: any) => {
      const ht = e.home_team?.toLowerCase() || "";
      const at = e.away_team?.toLowerCase() || "";
      return ht.includes(gameTeams.home.toLowerCase().split(" ").pop()) ||
             at.includes(gameTeams.away.toLowerCase().split(" ").pop());
    });

    if (!matchEvent) return null;

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

// ── 20 Factor Scoring Functions ──
// Each returns 0-100 where 50 is neutral

// 1. Goalie Save Percentage (league avg ~.908)
function scoreGoalieSvPct(svPct: number): number {
  const diff = svPct - 0.908;
  return Math.max(0, Math.min(100, 50 + diff * 800));
}

// 2. Goalie GAA (lower = better, league avg ~2.90)
function scoreGoalieGAA(gaa: number): number {
  const diff = 2.90 - gaa;
  return Math.max(0, Math.min(100, 50 + diff * 18));
}

// 3. Goalie Last 5 Starts SV% (recent form)
function scoreGoalieL5SvPct(l5SvPct: number): number {
  const diff = l5SvPct - 0.908;
  return Math.max(0, Math.min(100, 50 + diff * 900));
}

// 4. Backup Goalie (insurance if starter GTD)
function scoreBackupGoalie(backupSvPct: number): number {
  const diff = backupSvPct - 0.900;
  return Math.max(0, Math.min(100, 50 + diff * 600));
}

// 5. Team Shots Against Per Game (lower = better defense)
function scoreShotsAgainst(shotsAgainst: number): number {
  // League avg ~30 SA/game
  const diff = 30 - shotsAgainst;
  return Math.max(0, Math.min(100, 50 + diff * 3));
}

// 6. Goals Scored Per Game (higher = better, avg ~3.1)
function scoreGoalsPerGame(gpg: number): number {
  return Math.max(0, Math.min(100, 50 + (gpg - 3.1) * 18));
}

// 7. Team Shooting Percentage (league avg ~10%)
function scoreShootingPct(shootPct: number): number {
  return Math.max(0, Math.min(100, 50 + (shootPct - 10) * 10));
}

// 8. Power Play % (league avg ~21%)
function scorePPPct(ppPct: number): number {
  return Math.max(0, Math.min(100, 50 + (ppPct - 21) * 3));
}

// 9. Points/Game Last 10 (recent offensive form)
function scorePtsL10(ptsPerGame: number): number {
  // 1.0 pts/game = .500 pace, 2.0 = perfect
  return Math.max(0, Math.min(100, ptsPerGame * 50));
}

// 10. Goals Scored Last 5 Games (momentum)
function scoreGoalsL5(totalGoals: number): number {
  // Avg ~15.5 goals in 5 games
  const avg = totalGoals / 5;
  return Math.max(0, Math.min(100, 50 + (avg - 3.1) * 18));
}

// 11. Penalty Kill % (league avg ~79%)
function scorePKPct(pkPct: number): number {
  return Math.max(0, Math.min(100, 50 + (pkPct - 79) * 3));
}

// 12. Blocks + Hits Per Game (physical play proxy)
function scoreBlocksHits(blocksHits: number): number {
  // Rough league avg ~40 combined
  return Math.max(0, Math.min(100, 50 + (blocksHits - 40) * 1.5));
}

// 13. Goals Allowed Per Game (season avg, lower = better)
function scoreGoalsAllowed(gaPG: number): number {
  return Math.max(0, Math.min(100, 50 + (3.0 - gaPG) * 18));
}

// 14. High Danger Chances Against (lower = better defense)
function scoreHDChancesAgainst(hdca: number): number {
  // Approximate via GA and SA: teams with low SA and low GA face fewer HD chances
  return Math.max(0, Math.min(100, 50 + (10 - hdca) * 3));
}

// 15. Home/Away Goals Per Game Split
function scoreHomeAway(record: { wins: number; losses: number }, isHome: boolean): number {
  const total = record.wins + record.losses;
  if (total === 0) return isHome ? 55 : 45;
  const pct = record.wins / total;
  return Math.max(0, Math.min(100, pct * 100));
}

// 16. Rest Days (back-to-back detection)
function scoreRestDays(daysSinceLastGame: number): number {
  if (daysSinceLastGame === 0) return 30; // back-to-back, big penalty in NHL
  if (daysSinceLastGame === 1) return 50; // normal
  if (daysSinceLastGame >= 2) return 58; // extra rest
  return 50;
}

// 17. Last 5 W/L Momentum
function scoreMomentum(last5: string[]): number {
  const wins = last5.filter(r => r === "W").length;
  return Math.max(0, Math.min(100, wins * 20));
}

// 18. Head to Head Record (season)
function scoreH2H(winsVsOpp: number, totalVsOpp: number): number {
  if (totalVsOpp === 0) return 50;
  return Math.max(0, Math.min(100, (winsVsOpp / totalVsOpp) * 100));
}

// 19. Line Movement
function scoreLineMovement(openOdds: number, currentOdds: number): number {
  const shift = currentOdds - openOdds;
  return Math.max(0, Math.min(100, 50 + shift * 0.5));
}

// 20. Public Betting % vs Sharp Money
function scorePublicPercent(lineMovementMagnitude: number): number {
  return Math.max(0, Math.min(100, 50 + lineMovementMagnitude * 2));
}

// ── v2.0 NEW SCORERS (factors 21-26 + improved blends) ───
function scoreGoalieWorkload(startsLast7Days: number): number {
  if (startsLast7Days >= 4) return 42; // fatigue
  if (startsLast7Days === 0) return 46; // rust
  return 50; // 1-3 starts = neutral
}

function scoreSpecialTeamsDiff(ppPct: number, oppPkPct: number): number {
  const diff = ppPct - (100 - oppPkPct); // higher diff = bigger ST advantage
  return Math.max(0, Math.min(100, 50 + diff * 4));
}

function scoreArena(arenaFactor: number): number {
  // 1.10→75, 1.03→50, 0.95→35
  return Math.max(0, Math.min(100, 50 + (arenaFactor - 1.03) * 357));
}

function scoreGoalsBlend(l5: number, l10: number, l20: number): number {
  // Each is total goals over the window; normalize per-game to 3.1 baseline
  const avgL5 = l5 / 5;
  const avgL10 = l10 / 10;
  const avgL20 = l20 > 0 ? l20 / 20 : avgL10;
  const blended = avgL5 * 0.5 + avgL10 * 0.3 + avgL20 * 0.2;
  return Math.max(0, Math.min(100, 50 + (blended - 3.1) * 18));
}

function scoreGoalieL10Weighted(svPctL10: number[]): number {
  // Most recent start weighted 1.5x
  if (svPctL10.length === 0) return 50;
  let weighted = 0;
  let totalW = 0;
  for (let i = 0; i < svPctL10.length; i++) {
    const recencyW = 1 + (i / svPctL10.length) * 0.5; // newest entries assumed at end
    weighted += svPctL10[i] * recencyW;
    totalW += recencyW;
  }
  const avg = weighted / totalW;
  const diff = avg - 0.908;
  return Math.max(0, Math.min(100, 50 + diff * 900));
}

function scoreRestDaysV2(daysSinceLastGame: number, isB2BRoad: boolean): number {
  let s = scoreRestDays(daysSinceLastGame);
  if (daysSinceLastGame === 0 && isB2BRoad) s -= 5;
  return Math.max(0, Math.min(100, s));
}

// ── Legacy WEIGHTS table kept for backward compatibility (unused by v2 path) ──
const WEIGHTS: Record<string, Record<string, number>> = {
  moneyline: {
    goalie_sv: 0.18, goalie_gaa: 0.10, goalie_l5: 0.08, backup_goalie: 0.02,
    shots_against: 0.03, goals_game: 0.05, shooting_pct: 0.03, pp_pct: 0.04,
    pts_l10: 0.03, goals_l5: 0.07, pk_pct: 0.04, blocks_hits: 0.02,
    goals_allowed: 0.03, hd_chances: 0.02, home_away: 0.08, rest_days: 0.03,
    momentum: 0.07, h2h: 0.04, line_movement: 0.02, public_pct: 0.02,
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

function computeGoalDifferential(stats: Record<string, any>): { diff: number; games: number } {
  const goalsFor = stats.goalsFor || stats.goals || 0;
  const goalsAgainst = stats.goalsAgainst || 0;
  const games = stats.gamesPlayed || stats.games || 1;
  return { diff: goalsFor - goalsAgainst, games };
}

function computeH2H(schedule: any[], teamId: string, oppTeamId: string): { wins: number; total: number } {
  let wins = 0, total = 0;
  for (const ev of schedule) {
    const comp = ev.competitions?.[0];
    if (!comp || comp.status?.type?.name !== "STATUS_FINAL") continue;
    const tc = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
    const oc = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(oppTeamId));
    if (tc && oc) {
      total++;
      if (tc.winner) wins++;
    }
  }
  return { wins, total };
}

function computeGoalsLast5(events: any[], teamId: string): number {
  let total = 0;
  const completed = events.filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").slice(-5);
  for (const ev of completed) {
    const comp = ev.competitions[0];
    const tc = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
    if (tc) total += parseInt(tc.score || "0", 10);
  }
  return total;
}

function computePtsPerGameL10(events: any[], teamId: string): number {
  const completed = events.filter(e => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").slice(-10);
  if (completed.length === 0) return 1.0;
  let pts = 0;
  for (const ev of completed) {
    const comp = ev.competitions[0];
    const tc = comp.competitors?.find((c: any) => String(c.team?.id || c.id) === String(teamId));
    if (tc?.winner) pts += 2;
    // OT loss = 1 point (check if game went to OT)
    else if (comp.status?.period > 3) pts += 1;
  }
  return pts / completed.length;
}

// ── Injury Intelligence ──
function adjustForInjuries(injuries: any[], factors: Record<string, number>): { adjustedFactors: Record<string, number>; warnings: string[] } {
  const warnings: string[] = [];
  const adjusted = { ...factors };

  const keyOut = injuries.filter(i => {
    const s = (i.status || "").toLowerCase();
    return s.includes("out") || s.includes("injured reserve") || s.includes("ir") || s.includes("day-to-day") || s.includes("dtd");
  });

  // Goalie injuries are the biggest variable
  const goaliesOut = keyOut.filter(i => i.isGoalie);
  if (goaliesOut.length > 0) {
    const penalty = 15;
    adjusted.goalie_sv = Math.max(0, (adjusted.goalie_sv || 50) - penalty);
    adjusted.goalie_gaa = Math.max(0, (adjusted.goalie_gaa || 50) - penalty);
    adjusted.goalie_l5 = Math.max(0, (adjusted.goalie_l5 || 50) - penalty);
    for (const g of goaliesOut) {
      warnings.push(`⚠️ ${g.name} (G) — ${g.status}: ${g.detail || "Goalie swap may be required"}`);
    }
  }

  const skaterOut = keyOut.filter(i => i.isKey && !i.isGoalie);
  if (skaterOut.length > 0) {
    const penalty = Math.min(skaterOut.length * 4, 16);
    adjusted.goals_game = Math.max(0, (adjusted.goals_game || 50) - penalty);
    adjusted.shooting_pct = Math.max(0, (adjusted.shooting_pct || 50) - penalty * 0.6);
    adjusted.pp_pct = Math.max(0, (adjusted.pp_pct || 50) - penalty * 0.5);
    for (const p of skaterOut) {
      warnings.push(`⚠️ ${p.name} (${p.position}) — ${p.status}: ${p.detail || "No details"}`);
    }
  }

  return { adjustedFactors: adjusted, warnings };
}

// ── v2.0 Main Analysis Engine — uses WEIGHTS_V2 ──
function runModelV2(
  betType: string,
  team1Factors: Record<string, number>,
  team2Factors: Record<string, number>,
  sharedFactors: Record<string, number>,
): { confidence: number; verdict: string; tier: string; factorBreakdown: any[] } {
  const weights = WEIGHTS_V2[betType] || WEIGHTS_V2.moneyline;

  const factorBreakdown: any[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [factor, weight] of Object.entries(weights)) {
    if (weight === 0) continue; // explicit zeros excluded by design

    const t1Score = team1Factors[factor] ?? sharedFactors[factor] ?? 50;
    const t2Score = team2Factors[factor] ?? 50;
    const safe1 = isNaN(t1Score) ? 50 : t1Score;
    const safe2 = isNaN(t2Score) ? 50 : t2Score;

    let advantageScore: number;
    if (["line_movement", "public_pct", "rlm", "arena", "pace"].includes(factor)) {
      advantageScore = sharedFactors[factor] ?? 50;
    } else {
      advantageScore = 50 + (safe1 - safe2) / 2;
    }
    if (isNaN(advantageScore)) advantageScore = 50;
    advantageScore = Math.max(0, Math.min(100, advantageScore));

    factorBreakdown.push({
      factor,
      label: FACTOR_LABELS[factor] || factor,
      weight: Math.round(weight * 1000) / 10,
      team1Score: Math.round(safe1),
      team2Score: Math.round(safe2),
      advantageScore: Math.round(advantageScore),
      contribution: Math.round(advantageScore * weight * 10) / 10,
    });

    weightedSum += advantageScore * weight;
    totalWeight += weight;
  }

  const confidence = Math.round(totalWeight > 0 ? weightedSum / totalWeight : 50);
  let verdict: string, tier: string;
  if (confidence >= 75) { verdict = "STRONG PICK"; tier = "S"; }
  else if (confidence >= 65) { verdict = "LEAN"; tier = "A"; }
  else if (confidence >= 55) { verdict = "RISKY"; tier = "B"; }
  else { verdict = "FADE"; tier = "C"; }

  return { confidence, verdict, tier, factorBreakdown };
}

function formatFactorLabel(factor: string): string {
  const labels: Record<string, string> = {
    goalie_sv: "Goalie Save %", goalie_gaa: "Goalie GAA", goalie_l5: "Goalie L5 Save %",
    backup_goalie: "Backup Goalie", shots_against: "Shots Against/Game",
    goals_game: "Goals/Game", shooting_pct: "Shooting %", pp_pct: "Power Play %",
    pts_l10: "Points/Game L10", goals_l5: "Goals L5 Momentum",
    pk_pct: "Penalty Kill %", blocks_hits: "Blocks + Hits/Game",
    goals_allowed: "Goals Allowed/Game", hd_chances: "HD Chances Against",
    home_away: "Home/Away Record", rest_days: "Rest Days",
    momentum: "L5 W/L Momentum", h2h: "Head-to-Head",
    line_movement: "Line Movement", public_pct: "Sharp Money",
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

    const btLabel = betType === "puckline" ? "puck line" : betType === "total" ? "over/under" : betType;
    const goalieInfo = prediction.goalies
      ? `Home goalie: ${prediction.goalies.home?.name || "TBD"} (SV% ${prediction.goalies.home?.savePct || "N/A"}, GAA ${prediction.goalies.home?.gaa || "N/A"}). Away goalie: ${prediction.goalies.away?.name || "TBD"} (SV% ${prediction.goalies.away?.savePct || "N/A"}, GAA ${prediction.goalies.away?.gaa || "N/A"}).`
      : "";
    const injuryInfo = (prediction.warnings || []).join("; ") || "None reported";

    const prompt = betType === "player_prop"
      ? `You are a sharp NHL analyst. ${goalieInfo} Top matchup factors: ${topFactors}. Injuries: ${injuryInfo}. Write 2-3 sentences about how the team matchup context (goalies, special teams, pace) affects this player prop. Do NOT state a confidence percentage or verdict.`
      : `You are a sharp NHL analyst. ${btLabel} pick: ${prediction.confidence}% confidence, ${prediction.verdict}. ${goalieInfo} Key factors: ${topFactors}. Injuries: ${injuryInfo}. Write ONE short paragraph (2-3 sentences max, under 200 characters). Be direct, no headers, no bullets, no bold text.`;

    const result = await callAI({
      fnName: "nhl-model",
      messages: [
        { role: "system", content: `You are a concise NHL analyst. Write a single short paragraph, no markdown formatting, no bold, no headers. Maximum 2-3 sentences. ${ANTI_GENERIC_INSTRUCTION}` },
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
    if (!(e instanceof AIProviderError)) console.error("nhl-model writeup error:", e);
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

  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean).pop() || "";

  try {
    const supabase = getClient();

    // ─── GET /games — Today's NHL games ───
    if (path === "games" && req.method === "GET") {
      const events = await getScoreboard();
      const games = await Promise.all(events.map(async (ev: any) => {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
        const goalies = await getStartingGoalieInfo(ev);

        const venue = comp?.venue?.fullName || "";

        return {
          id: ev.id,
          name: ev.name,
          shortName: ev.shortName,
          date: ev.date,
          status: comp?.status?.type?.name || "pre",
          venue,
          arenaFactor: getArenaFactor(venue),
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
          goalies: {
            home: goalies.home || { name: "TBD", savePct: 0, gaa: 0 },
            away: goalies.away || { name: "TBD", savePct: 0, gaa: 0 },
          },
        };
      }));

      return json({ games, date: new Date().toISOString().split("T")[0] });
    }

    // ─── POST /analyze — Full 20-factor analysis ───
    if (path === "analyze" && req.method === "POST") {
      const body = await req.json();
      const { game_id, bet_type = "moneyline", team1_id, team2_id, over_under, player_name, prop_type, line, team1_is_home } = body;

      if (!team1_id || !team2_id) return json({ error: "team1_id and team2_id are required" }, 400);
      if (!["moneyline", "puckline", "total", "player_prop"].includes(bet_type)) {
        return json({ error: "Invalid bet_type. Use: moneyline, puckline, total, player_prop" }, 400);
      }

      // Check cache
      if (game_id) {
        const { data: cached } = await supabase
          .from("nhl_predictions")
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
      let goalies = { home: null as any, away: null as any };
      let arenaFactor = 1.03;

      if (game_id) {
        const events = await getScoreboard();
        eventData = events.find((e: any) => String(e.id) === String(game_id));
        if (eventData) {
          goalies = await getStartingGoalieInfo(eventData);
          const comp = eventData.competitions?.[0];
          arenaFactor = getArenaFactor(comp?.venue?.fullName || "");
        }
      }

      // Resolve real home/away role for each team (orchestrator-supplied venue)
      const team1IsHome: boolean | null = typeof team1_is_home === "boolean" ? team1_is_home : null;
      const neutralGoalie = { savePct: 0.908, gaa: 2.90, stats: {}, name: undefined as string | undefined };
      const team1Goalie = team1IsHome === true ? (goalies.home || neutralGoalie)
                        : team1IsHome === false ? (goalies.away || neutralGoalie)
                        : neutralGoalie;
      const team2Goalie = team1IsHome === true ? (goalies.away || neutralGoalie)
                        : team1IsHome === false ? (goalies.home || neutralGoalie)
                        : neutralGoalie;

      // Compute context
      const splits1 = computeHomeAwaySplits(schedule1, team1_id);
      const splits2 = computeHomeAwaySplits(schedule2, team2_id);
      const last5_1 = computeLast5(schedule1, team1_id);
      const last5_2 = computeLast5(schedule2, team2_id);
      const rest1 = computeRestDays(schedule1);
      const rest2 = computeRestDays(schedule2);
      const gd1 = computeGoalDifferential(stats1);
      const gd2 = computeGoalDifferential(stats2);
      const h2h = computeH2H(schedule1, team1_id, team2_id);
      const goalsL5_1 = computeGoalsLast5(schedule1, team1_id);
      const goalsL5_2 = computeGoalsLast5(schedule2, team2_id);
      const ptsL10_1 = computePtsPerGameL10(schedule1, team1_id);
      const ptsL10_2 = computePtsPerGameL10(schedule2, team2_id);

      // ── v2.0 advanced stats ──
      const xg1 = computeXGProxy(schedule1, team1_id);
      const xg2 = computeXGProxy(schedule2, team2_id);
      const cf1 = computeCFProxy(schedule1, team1_id);
      const cf2 = computeCFProxy(schedule2, team2_id);
      const paceCombined = computePace(schedule1, team1_id, schedule2, team2_id);

      const ppPct1 = stats1.powerPlayPct || stats1.powerPlayPercentage || 21;
      const ppPct2 = stats2.powerPlayPct || stats2.powerPlayPercentage || 21;
      const pkPct1 = stats1.penaltyKillPct || stats1.penaltyKillPercentage || 79;
      const pkPct2 = stats2.penaltyKillPct || stats2.penaltyKillPercentage || 79;

      // Goalie starts in last 7 days from schedule (best-effort)
      const startsIn7d = (events: any[]) => {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return events.filter((e) => {
          const st = e.competitions?.[0]?.status?.type;
          return (st?.completed || st?.name === "STATUS_FINAL") && new Date(e.date).getTime() >= cutoff;
        }).length;
      };
      const workload1 = startsIn7d(schedule1);
      const workload2 = startsIn7d(schedule2);

      const team1Factors: Record<string, number> = {
        goalie_sv: scoreGoalieSvPct(team1Goalie.savePct),
        goalie_gaa: scoreGoalieGAA(team1Goalie.gaa),
        goalie_l5: scoreGoalieL5SvPct(team1Goalie.savePct),
        goalie_l10: scoreGoalieL10Weighted([team1Goalie.savePct]),
        backup_goalie: scoreBackupGoalie(0.900),
        shots_against: scoreShotsAgainst(stats1.shotsAgainstPerGame || stats1.shotsAgainst || 30),
        goals_game: scoreGoalsPerGame(stats1.goalsPerGame || stats1.goalsFor / Math.max(stats1.gamesPlayed || 1, 1) || 3.1),
        shooting_pct: scoreShootingPct(stats1.shootingPctg || stats1.shootingPct || 10),
        pp_pct: scorePPPct(ppPct1),
        pk_pct: scorePKPct(pkPct1),
        pts_l10: scorePtsL10(ptsL10_1),
        goals_l5: scoreGoalsL5(goalsL5_1),
        goals_blend: scoreGoalsBlend(goalsL5_1, goalsL5_1 * 2, goalsL5_1 * 4),
        blocks_hits: scoreBlocksHits((stats1.blockedShots || 15) + (stats1.hits || 25)),
        goals_allowed: scoreGoalsAllowed(stats1.goalsAgainstPerGame || stats1.goalsAgainst / Math.max(stats1.gamesPlayed || 1, 1) || 3.0),
        hd_chances: scoreHDChancesAgainst(stats1.shotsAgainstPerGame ? stats1.shotsAgainstPerGame * 0.35 : 10),
        home_away: team1IsHome === null ? scoreHomeAway({ wins: 0, losses: 0 }, false) : scoreHomeAway(team1IsHome ? splits1.home : splits1.away, team1IsHome),
        rest_days: scoreRestDaysV2(rest1, false),
        momentum: scoreMomentum(last5_1),
        h2h: scoreH2H(h2h.wins, h2h.total),
        xg: scoreXG(xg1.xG60),
        goalie_workload: scoreGoalieWorkload(workload1),
        st_diff: scoreSpecialTeamsDiff(ppPct1, pkPct2),
        cf_proxy: scoreCFProxy(cf1.cfPct),
      };

      const team2Factors: Record<string, number> = {
        goalie_sv: scoreGoalieSvPct(team2Goalie.savePct),
        goalie_gaa: scoreGoalieGAA(team2Goalie.gaa),
        goalie_l5: scoreGoalieL5SvPct(team2Goalie.savePct),
        goalie_l10: scoreGoalieL10Weighted([team2Goalie.savePct]),
        backup_goalie: scoreBackupGoalie(0.900),
        shots_against: scoreShotsAgainst(stats2.shotsAgainstPerGame || stats2.shotsAgainst || 30),
        goals_game: scoreGoalsPerGame(stats2.goalsPerGame || stats2.goalsFor / Math.max(stats2.gamesPlayed || 1, 1) || 3.1),
        shooting_pct: scoreShootingPct(stats2.shootingPctg || stats2.shootingPct || 10),
        pp_pct: scorePPPct(ppPct2),
        pk_pct: scorePKPct(pkPct2),
        pts_l10: scorePtsL10(ptsL10_2),
        goals_l5: scoreGoalsL5(goalsL5_2),
        goals_blend: scoreGoalsBlend(goalsL5_2, goalsL5_2 * 2, goalsL5_2 * 4),
        blocks_hits: scoreBlocksHits((stats2.blockedShots || 15) + (stats2.hits || 25)),
        goals_allowed: scoreGoalsAllowed(stats2.goalsAgainstPerGame || stats2.goalsAgainst / Math.max(stats2.gamesPlayed || 1, 1) || 3.0),
        hd_chances: scoreHDChancesAgainst(stats2.shotsAgainstPerGame ? stats2.shotsAgainstPerGame * 0.35 : 10),
        home_away: team1IsHome === null ? scoreHomeAway({ wins: 0, losses: 0 }, false) : scoreHomeAway(team1IsHome ? splits2.away : splits2.home, !team1IsHome),
        rest_days: scoreRestDaysV2(rest2, false),
        momentum: scoreMomentum(last5_2),
        h2h: scoreH2H(h2h.total - h2h.wins, h2h.total),
        xg: scoreXG(xg2.xG60),
        goalie_workload: scoreGoalieWorkload(workload2),
        st_diff: scoreSpecialTeamsDiff(ppPct2, pkPct1),
        cf_proxy: scoreCFProxy(cf2.cfPct),
      };

      // ── Shared factors (line movement / RLM / arena / pace) ──
      const sharedFactors: Record<string, number> = {
        line_movement: 50, public_pct: 50, rlm: 50,
        arena: scoreArena(arenaFactor),
        pace: scorePace(paceCombined),
      };

      let lineMovementSide: "home" | "away" | "neutral" = "neutral";
      let sharpMoneyTriggered = false;
      if (game_id && eventData) {
        try {
          const odds = await getOddsForGame(supabase, {
            home: eventData.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "home")?.team?.displayName || "",
            away: eventData.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "away")?.team?.displayName || "",
          });
          const history = await pullOddsHistory(supabase, String(game_id), "h2h");
          if (odds?.h2h) {
            const current = (odds.h2h || []).map((o: any) => ({
              book: o.book || "unknown", price: o.price || 0, market: "h2h",
            }));
            const lm = computeLineMovement(history, current);
            sharedFactors.line_movement = scoreLineMovement19(lm);
            lineMovementSide = lm.side;
            const rlm = computeRLM(history, null, current, "h2h");
            sharedFactors.rlm = scoreRLM20(rlm);
            sharpMoneyTriggered = rlm.triggered || sharpBookDivergence(current).diverges;
          }
        } catch (e) { console.error("odds intel error:", (e as Error).message); }
      }

      // ── v2 injury adjustments ──
      const inj1 = await nhlInjuryAdjustments(team1_id, injuries1, team1Factors, team1Goalie?.name, 0.905);
      const inj2 = await nhlInjuryAdjustments(team2_id, injuries2, team2Factors, team2Goalie?.name, 0.905);

      if (bet_type === "player_prop" && player_name) {
        const pInj = [...injuries1, ...injuries2].find((i) =>
          i.name.toLowerCase().includes(player_name.toLowerCase()),
        );
        if (pInj && (pInj.status === "out" || pInj.status === "doubtful")) {
          return json({ error: `Cannot generate prediction: ${player_name} is ${pInj.status}`, blocked: true, injury: pInj }, 400);
        }
      }

      const result = runModelV2(bet_type, inj1.adjustedFactors, inj2.adjustedFactors, sharedFactors);

      const topFactors = [...result.factorBreakdown]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3);

      const writeup = await generateWriteup(
        { ...result, warnings: [...inj1.warnings, ...inj2.warnings].map((w) => `${w.player} (${w.position}) — ${w.status}`) },
        bet_type,
      );

      const goalieWarning = [...inj1.warnings, ...inj2.warnings].find((w) =>
        (w.affected_factor || "").includes("goalie"),
      );

      const prediction = {
        bet_type,
        model_version: MODEL_VERSION,
        confidence: result.confidence,
        verdict: result.verdict,
        confidence_tier: result.tier,
        factorBreakdown: result.factorBreakdown,
        top_factors: topFactors,
        line_movement_indicator: lineMovementSide === "home" ? "↑" : lineMovementSide === "away" ? "↓" : "=",
        sharp_money_indicator: sharpMoneyTriggered,
        goalie_warning: goalieWarning ? `${goalieWarning.player} ${goalieWarning.status}` : null,
        injury_warnings: [...inj1.warnings, ...inj2.warnings],
        writeup,
        injuries: { team1: injuries1, team2: injuries2 },
        goalies: { home: homeGoalie, away: awayGoalie },
        context: {
          arenaFactor,
          xg: { team1: xg1.xG60, team2: xg2.xG60, fallback: xg1.fallback || xg2.fallback },
          cf: { team1: cf1.cfPct, team2: cf2.cfPct },
          pace: paceCombined,
          workload: { team1: workload1, team2: workload2 },
          momentum: { team1: last5_1, team2: last5_2 },
          splits: { team1: splits1, team2: splits2 },
          goalDiff: { team1: gd1, team2: gd2 },
        },
      };

      // Per-factor audit log (service-role only)
      if (game_id) {
        try {
          const factorRows = result.factorBreakdown.map((f: any) => ({
            game_id: String(game_id),
            factor_name: f.factor,
            score: f.advantageScore,
            weight: f.weight / 100, // back to fraction
            bet_type,
            model_version: MODEL_VERSION,
          }));
          if (factorRows.length > 0) {
            await supabase.from("nhl_factor_log").insert(factorRows);
          }
        } catch (e) { console.error("nhl_factor_log insert failed:", (e as Error).message); }
      }

      if (game_id && !player_name) {
        try {
          await supabase.from("nhl_predictions").insert({
            game_id: String(game_id), bet_type, prediction,
            confidence: result.confidence, verdict: result.verdict,
            prediction_date: new Date().toISOString().split("T")[0],
          });
        } catch (_) { /* ok */ }
      }

      logSnapshot({
        sport: "nhl", market_type: bet_type,
        player_or_team: player_name || `${team1_id} vs ${team2_id}`,
        prop_type: prop_type || null,
        line: typeof line === "string" ? parseFloat(line) : (line ?? null),
        direction: over_under || null,
        confidence: result.confidence, verdict: result.verdict,
        top_factors: topFactors,
      }).catch((err) => console.error("logSnapshot failed:", err));

      return json(prediction);
    }

    return json({ error: "Not found. Use GET /games or POST /analyze" }, 404);

  } catch (e: any) {
    console.error("nhl-model error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
