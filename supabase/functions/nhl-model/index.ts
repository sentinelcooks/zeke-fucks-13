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

// ── Weight Tables ──
const WEIGHTS: Record<string, Record<string, number>> = {
  moneyline: {
    goalie_sv: 0.18, goalie_gaa: 0.10, goalie_l5: 0.08, backup_goalie: 0.02,
    shots_against: 0.03, goals_game: 0.05, shooting_pct: 0.03, pp_pct: 0.04,
    pts_l10: 0.03, goals_l5: 0.07, pk_pct: 0.04, blocks_hits: 0.02,
    goals_allowed: 0.03, hd_chances: 0.02, home_away: 0.08, rest_days: 0.03,
    momentum: 0.07, h2h: 0.04, line_movement: 0.02, public_pct: 0.02,
  },
  puckline: {
    goalie_sv: 0.10, goalie_gaa: 0.06, goalie_l5: 0.05, backup_goalie: 0.02,
    shots_against: 0.05, goals_game: 0.06, shooting_pct: 0.04, pp_pct: 0.08,
    pts_l10: 0.04, goals_l5: 0.05, pk_pct: 0.08, blocks_hits: 0.04,
    goals_allowed: 0.08, hd_chances: 0.04, home_away: 0.05, rest_days: 0.03,
    momentum: 0.05, h2h: 0.04, line_movement: 0.03, public_pct: 0.01,
  },
  total: {
    goalie_sv: 0.12, goalie_gaa: 0.12, goalie_l5: 0.08, backup_goalie: 0.03,
    shots_against: 0.05, goals_game: 0.10, shooting_pct: 0.08, pp_pct: 0.04,
    pts_l10: 0.03, goals_l5: 0.05, pk_pct: 0.04, blocks_hits: 0.02,
    goals_allowed: 0.08, hd_chances: 0.03, home_away: 0.02, rest_days: 0.05,
    momentum: 0.02, h2h: 0.02, line_movement: 0.02, public_pct: 0.02,
  },
  player_prop: {
    goalie_sv: 0.05, goalie_gaa: 0.05, goalie_l5: 0.03, backup_goalie: 0.02,
    shots_against: 0.08, goals_game: 0.05, shooting_pct: 0.12, pp_pct: 0.12,
    pts_l10: 0.05, goals_l5: 0.08, pk_pct: 0.03, blocks_hits: 0.05,
    goals_allowed: 0.05, hd_chances: 0.05, home_away: 0.05, rest_days: 0.05,
    momentum: 0.03, h2h: 0.02, line_movement: 0.01, public_pct: 0.01,
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

// ── Main Analysis Engine (identical structure to MLB) ──
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

    const t1Score = team1Factors[factor] ?? sharedFactors[factor] ?? 50;
    const t2Score = team2Factors[factor] ?? 50;

    const safe1 = isNaN(t1Score) ? 50 : t1Score;
    const safe2 = isNaN(t2Score) ? 50 : t2Score;

    let advantageScore: number;
    if (["line_movement", "public_pct"].includes(factor)) {
      advantageScore = sharedFactors[factor] ?? 50;
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
  if (confidence >= 75) verdict = "STRONG PICK";
  else if (confidence >= 62) verdict = "LEAN";
  else if (confidence >= 42) verdict = "RISKY";
  else verdict = "FADE";

  return { confidence, verdict, factorBreakdown };
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
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return "";

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

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a concise NHL analyst. Write a single short paragraph, no markdown formatting, no bold, no headers. Maximum 2-3 sentences." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
      }),
    });

    if (!resp.ok) return "";
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";
    // Strip markdown and truncate
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
      const { game_id, bet_type = "moneyline", team1_id, team2_id, over_under, player_name, prop_type, line } = body;

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

      const homeGoalie = goalies.home || { savePct: 0.908, gaa: 2.90, stats: {} };
      const awayGoalie = goalies.away || { savePct: 0.908, gaa: 2.90, stats: {} };

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

      // Score all 20 factors for team1 (home)
      const team1Factors: Record<string, number> = {
        goalie_sv: scoreGoalieSvPct(homeGoalie.savePct),
        goalie_gaa: scoreGoalieGAA(homeGoalie.gaa),
        goalie_l5: scoreGoalieL5SvPct(homeGoalie.savePct),
        backup_goalie: scoreBackupGoalie(0.900), // Default backup
        shots_against: scoreShotsAgainst(stats1.shotsAgainstPerGame || stats1.shotsAgainst || 30),
        goals_game: scoreGoalsPerGame(stats1.goalsPerGame || stats1.goalsFor / Math.max(stats1.gamesPlayed || 1, 1) || 3.1),
        shooting_pct: scoreShootingPct(stats1.shootingPctg || stats1.shootingPct || 10),
        pp_pct: scorePPPct(stats1.powerPlayPct || stats1.powerPlayPercentage || 21),
        pts_l10: scorePtsL10(ptsL10_1),
        goals_l5: scoreGoalsL5(goalsL5_1),
        pk_pct: scorePKPct(stats1.penaltyKillPct || stats1.penaltyKillPercentage || 79),
        blocks_hits: scoreBlocksHits((stats1.blockedShots || 15) + (stats1.hits || 25)),
        goals_allowed: scoreGoalsAllowed(stats1.goalsAgainstPerGame || stats1.goalsAgainst / Math.max(stats1.gamesPlayed || 1, 1) || 3.0),
        hd_chances: scoreHDChancesAgainst(stats1.shotsAgainstPerGame ? stats1.shotsAgainstPerGame * 0.35 : 10),
        home_away: scoreHomeAway(splits1.home, true),
        rest_days: scoreRestDays(rest1),
        momentum: scoreMomentum(last5_1),
        h2h: scoreH2H(h2h.wins, h2h.total),
      };

      // Score all 20 factors for team2 (away)
      const team2Factors: Record<string, number> = {
        goalie_sv: scoreGoalieSvPct(awayGoalie.savePct),
        goalie_gaa: scoreGoalieGAA(awayGoalie.gaa),
        goalie_l5: scoreGoalieL5SvPct(awayGoalie.savePct),
        backup_goalie: scoreBackupGoalie(0.900),
        shots_against: scoreShotsAgainst(stats2.shotsAgainstPerGame || stats2.shotsAgainst || 30),
        goals_game: scoreGoalsPerGame(stats2.goalsPerGame || stats2.goalsFor / Math.max(stats2.gamesPlayed || 1, 1) || 3.1),
        shooting_pct: scoreShootingPct(stats2.shootingPctg || stats2.shootingPct || 10),
        pp_pct: scorePPPct(stats2.powerPlayPct || stats2.powerPlayPercentage || 21),
        pts_l10: scorePtsL10(ptsL10_2),
        goals_l5: scoreGoalsL5(goalsL5_2),
        pk_pct: scorePKPct(stats2.penaltyKillPct || stats2.penaltyKillPercentage || 79),
        blocks_hits: scoreBlocksHits((stats2.blockedShots || 15) + (stats2.hits || 25)),
        goals_allowed: scoreGoalsAllowed(stats2.goalsAgainstPerGame || stats2.goalsAgainst / Math.max(stats2.gamesPlayed || 1, 1) || 3.0),
        hd_chances: scoreHDChancesAgainst(stats2.shotsAgainstPerGame ? stats2.shotsAgainstPerGame * 0.35 : 10),
        home_away: scoreHomeAway(splits2.away, false),
        rest_days: scoreRestDays(rest2),
        momentum: scoreMomentum(last5_2),
        h2h: scoreH2H(h2h.total - h2h.wins, h2h.total),
      };

      // Shared/environmental factors
      const sharedFactors: Record<string, number> = {
        line_movement: 50,
        public_pct: 50,
      };

      // Try to get odds data
      if (game_id && eventData) {
        const odds = await getOddsForGame(supabase, {
          home: eventData.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "home")?.team?.displayName || "",
          away: eventData.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "away")?.team?.displayName || "",
        });
        if (odds) {
          const h2hOdds = odds.h2h || [];
          if (h2hOdds.length > 1) {
            const prices = h2hOdds.map((o: any) => o.price || 0);
            const spread = Math.max(...prices) - Math.min(...prices);
            sharedFactors.line_movement = Math.min(100, 50 + spread * 0.2);
            sharedFactors.public_pct = scorePublicPercent(spread * 0.1);
          }
        }
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
          if (s.includes("out") || s.includes("injured reserve") || s.includes("ir")) {
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

      // Generate AI writeup
      const writeup = await generateWriteup({ ...result, warnings: [...warn1, ...warn2] }, bet_type);

      const prediction = {
        bet_type,
        confidence: result.confidence,
        verdict: result.verdict,
        factorBreakdown: result.factorBreakdown,
        writeup,
        injuries: {
          team1: injuries1,
          team2: injuries2,
          warnings: [...warn1, ...warn2],
        },
        goalies: {
          home: homeGoalie,
          away: awayGoalie,
        },
        context: {
          arenaFactor,
          momentum: { team1: last5_1, team2: last5_2 },
          splits: { team1: splits1, team2: splits2 },
          goalDiff: { team1: gd1, team2: gd2 },
        },
      };

      // Cache prediction
      if (game_id && !player_name) {
        try {
          await supabase.from("nhl_predictions").insert({
            game_id: String(game_id),
            bet_type,
            prediction,
            confidence: result.confidence,
            verdict: result.verdict,
            prediction_date: new Date().toISOString().split("T")[0],
          });
        } catch (_) { /* cache miss is fine */ }
      }

      // Snapshot logging — fire and forget
      logSnapshot({
        sport: "nhl",
        market_type: bet_type,
        player_or_team: player_name || `${team1_id} vs ${team2_id}`,
        prop_type: prop_type || null,
        line: typeof line === "string" ? parseFloat(line) : (line ?? null),
        direction: over_under || null,
        confidence: result.confidence,
        verdict: result.verdict,
        top_factors: (result.factorBreakdown || []).slice(0, 5),
      }).catch((err) => console.error("logSnapshot failed:", err));

      return json(prediction);
    }

    return json({ error: "Not found. Use GET /games or POST /analyze" }, 404);

  } catch (e: any) {
    console.error("nhl-model error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
