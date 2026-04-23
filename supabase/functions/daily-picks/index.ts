import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, ANTI_GENERIC_INSTRUCTION } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp",
};


// ── Retry with exponential backoff for rate-limited calls ──
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, label = ""): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const isRateLimit = e?.message?.includes?.("RateLimitError") || e?.message?.includes?.("429") || e?.status === 429;
      if (!isRateLimit || attempt === maxRetries) throw e;
      const waitMs = Math.pow(2, attempt + 1) * 1000 + Math.random() * 1000;
      console.warn(`⏳ Rate limited${label ? ` (${label})` : ""}, retry ${attempt + 1}/${maxRetries} in ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw new Error("retryWithBackoff exhausted");
}

// ── Delay helper ──
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const ESPN_SPORTS: Record<string, { sport: string; league: string }> = {
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
};

// ── Fetch real market odds for a pick via nba-odds/player-odds ──
// Send raw prop type (e.g. "strikeouts", "points") — nba-odds handles normalization
async function fetchRealOdds(
  playerName: string, propType: string, overUnder: string, sport: string,
  supabaseUrl: string, serviceKey: string
): Promise<string | null> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/nba-odds/player-odds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ playerName, propType, overUnder, sport }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.found && data.books?.length > 0) {
      const prices = data.books.map((b: any) => b.odds ?? b.price).filter((p: number) => typeof p === "number");
      if (prices.length > 0) {
        const best = Math.max(...prices);
        return best > 0 ? `+${best}` : `${best}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Fetch moneyline/spread/total odds from events endpoint ──
async function fetchGameOdds(
  teamName: string, betType: string, sport: string,
  supabaseUrl: string, serviceKey: string
): Promise<string | null> {
  try {
    const marketKey = betType === "spread" ? "spreads" : betType === "total" || betType === "over_under" ? "totals" : "h2h";
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/nba-odds/events?sport=${sport}&markets=${marketKey}`,
      {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const events = data?.events || [];
    const normalizedTeam = teamName.toLowerCase().trim();

    for (const event of events) {
      // Check if this event involves the team
      const homeMatch = event.home_team?.toLowerCase().includes(normalizedTeam) || normalizedTeam.includes(event.home_team?.toLowerCase() || "");
      const awayMatch = event.away_team?.toLowerCase().includes(normalizedTeam) || normalizedTeam.includes(event.away_team?.toLowerCase() || "");
      const isTotal = marketKey === "totals";
      if (!homeMatch && !awayMatch && !isTotal) continue;
      // For totals, match on "away @ home" pattern
      if (isTotal && !normalizedTeam.includes("@") && !homeMatch && !awayMatch) continue;

      for (const bk of (event.bookmakers || [])) {
        for (const market of (bk.markets || [])) {
          if (market.key !== marketKey) continue;
          for (const outcome of (market.outcomes || [])) {
            // For h2h/spreads: match the team name; for totals: take "Over"
            const nameMatch = isTotal
              ? outcome.name?.toLowerCase() === "over"
              : outcome.name?.toLowerCase().includes(normalizedTeam) || normalizedTeam.includes(outcome.name?.toLowerCase() || "");
            if (nameMatch) {
              const price = outcome.price;
              return price > 0 ? `+${price}` : `${price}`;
            }
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Model endpoints per sport for game-level bets
const SPORT_MODEL_MAP: Record<string, string> = {
  nba: "moneyline-api",
  mlb: "mlb-model",
  nhl: "nhl-model",
};

interface GameInfo {
  gameId: string;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
  sport: string;
}

// ── Fetch today's games from ESPN for a sport ──
async function getGamesForSport(sportKey: string): Promise<GameInfo[]> {
  const mapping = ESPN_SPORTS[sportKey];
  if (!mapping) return [];
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const resp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${mapping.sport}/${mapping.league}/scoreboard?dates=${today}`
    );
    if (!resp.ok) { await resp.text(); return []; }
    const data = await resp.json();
    return (data?.events || []).map((e: any) => {
      const comps = e?.competitions?.[0]?.competitors || [];
      const home = comps.find((c: any) => c.homeAway === "home");
      const away = comps.find((c: any) => c.homeAway === "away");
      return {
        gameId: e.id,
        home: home?.team?.displayName || "TBD",
        away: away?.team?.displayName || "TBD",
        homeId: home?.team?.id || "",
        awayId: away?.team?.id || "",
        sport: sportKey,
      };
    });
  } catch (e) {
    console.error(`ESPN ${sportKey} error:`, e);
    return [];
  }
}

// ── Fetch full lineup for a game ──
async function getGameLineup(gameId: string, sportKey: string): Promise<Array<{ name: string; team: string; opponent: string }>> {
  const mapping = ESPN_SPORTS[sportKey];
  if (!mapping) return [];
  try {
    const resp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${mapping.sport}/${mapping.league}/summary?event=${gameId}`
    );
    if (!resp.ok) { await resp.text(); return []; }
    const data = await resp.json();
    const players: Array<{ name: string; team: string; opponent: string }> = [];
    const teams = data?.boxscore?.teams || [];

    for (const team of teams) {
      const teamName = team?.team?.displayName || "";
      const other = teams.find((t: any) => t !== team);
      const opponentName = other?.team?.displayName || "";
      const athletes = team?.statistics?.[0]?.athletes || [];
      for (const a of athletes) {
        if (a?.athlete?.displayName) {
          players.push({ name: a.athlete.displayName, team: teamName, opponent: opponentName });
        }
      }
    }

    // Fallback to rosters if no box score
    if (players.length === 0) {
      const rosters = data?.rosters || [];
      for (const roster of rosters) {
        const teamName = roster?.team?.displayName || "";
        const other = rosters.find((r: any) => r !== roster);
        const opponentName = other?.team?.displayName || "";
        for (const entry of (roster?.roster || []).slice(0, 15)) {
          const name = entry?.athlete?.displayName || entry?.displayName;
          if (name) players.push({ name, team: teamName, opponent: opponentName });
        }
      }
    }

    return players;
  } catch (e) {
    console.error(`Lineup fetch error ${gameId}:`, e);
    return [];
  }
}

// ── Call sport model for game-level bets ──
async function analyzeGameBets(
  game: GameInfo,
  supabaseUrl: string,
  serviceKey: string,
  confidenceThreshold: number = 60
): Promise<Array<{
  bet_type: string; player_name: string; team: string; opponent: string;
  home_team: string; away_team: string; prop_type: string; line: number;
  direction: string; hit_rate: number; avg_value: number; reasoning: string;
  odds: string; spread_line: number | null; total_line: number | null; sport: string;
}>> {
  const modelEndpoint = SPORT_MODEL_MAP[game.sport];
  if (!modelEndpoint) return [];

  const picks: any[] = [];
  const betTypes = ["moneyline", "spread", "total"];

  for (const betType of betTypes) {
    try {
      const analyzePath = "/analyze";
      // moneyline-api/analyze expects team1/team2; mlb-model/nhl-model expect team1_id/team2_id
      const bodyPayload = modelEndpoint === "moneyline-api"
        ? { team1: game.home, team2: game.away, bet_type: betType, sport: game.sport,
            ...(betType === "spread" ? { spread_line: 0 } : {}),
            ...(betType === "total" ? { total_line: 210 } : {}) }
        : { team1_id: game.homeId, team2_id: game.awayId, bet_type: betType, game_id: game.gameId };
      console.log(`  Calling ${modelEndpoint}${analyzePath} for ${game.away}@${game.home} (${betType})`);
      const resp = await fetch(`${supabaseUrl}/functions/v1/${modelEndpoint}${analyzePath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!resp.ok) { const t = await resp.text(); console.warn(`  ${modelEndpoint} ${betType} HTTP ${resp.status}: ${t.slice(0, 200)}`); continue; }
      const data = await resp.json();
      console.log(`  ${modelEndpoint} ${betType} response confidence: ${data?.confidence ?? data?.model_confidence ?? 'N/A'}`);
      if (!data || data.error) { console.warn(`  ${modelEndpoint} error:`, data?.error); continue; }

      const confidence = data.confidence ?? data.model_confidence ?? 50;
      if (confidence < confidenceThreshold) continue;

      const verdict = data.verdict || data.pick || "";
      const reasoning = [
        verdict,
        data.reasoning ? (Array.isArray(data.reasoning) ? data.reasoning.slice(0, 2).join(". ") : data.reasoning) : "",
      ].filter(Boolean).join(". ");

      let pickBetType = "moneyline";
      let spreadLine: number | null = null;
      let totalLine: number | null = null;
      let direction = "over";
      let line = 0;
      let propType = "moneyline";
      let playerName = `${game.away} @ ${game.home}`;

      if (betType === "moneyline") {
        pickBetType = "moneyline";
        propType = "moneyline";
        direction = verdict.toLowerCase().includes(game.home.toLowerCase()) ? "home" : "away";
        playerName = direction === "home" ? game.home : game.away;
      } else if (betType === "spread") {
        pickBetType = "spread";
        propType = "spread";
        spreadLine = data.spread ?? data.line ?? 0;
        line = spreadLine || 0;
        direction = data.pick_direction || "home";
        playerName = direction === "home" ? game.home : game.away;
      } else if (betType === "total") {
        pickBetType = "over_under";
        propType = "total";
        totalLine = data.total ?? data.line ?? 0;
        line = totalLine || 0;
        direction = data.pick_direction || "over";
        playerName = `${game.away} @ ${game.home}`;
      }

      // Fetch real market odds — allow pick through with "N/A" if no odds found
      const oddsTeamOrPlayer = betType === "total" ? `${game.away} @ ${game.home}` : playerName;
      const realOdds = data.odds || await fetchGameOdds(oddsTeamOrPlayer, pickBetType, game.sport, supabaseUrl, serviceKey) || "N/A";
      if (realOdds === "N/A") {
        console.log(`  ⚠️ No real odds for ${playerName} (${pickBetType}), using N/A`);
      }

      picks.push({
        bet_type: pickBetType,
        player_name: playerName,
        team: game.home,
        opponent: game.away,
        home_team: game.home,
        away_team: game.away,
        prop_type: propType,
        line,
        direction,
        hit_rate: Math.round(confidence),
        avg_value: line,
        reasoning: reasoning || `Model confidence: ${confidence}%`,
        odds: realOdds,
        spread_line: spreadLine,
        total_line: totalLine,
        sport: game.sport,
      });
    } catch (e) {
      console.error(`Game bet error ${game.sport} ${betType}:`, e);
    }
  }

  return picks;
}

// ── Use nba-api model for player props ──
async function analyzePlayerProp(
  player: string, propType: string, line: number, direction: string,
  opponent: string, sport: string, supabaseUrl: string, serviceKey: string
): Promise<{ confidence: number; reasoning: string; avg_value: number; line: number; direction: string } | null> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/nba-api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({ player, prop_type: propType, line, over_under: direction, sport, opponent }),
    });
    if (!resp.ok) { await resp.text(); return null; }
    const data = await resp.json();
    if (!data || data.error) return null;

    const confidence = data.confidence ?? 50;
    const seasonAvg = data.season_avg && typeof data.season_avg === "object"
      ? (data.season_avg[propType] ?? data.season_avg.PTS ?? null) : null;

    const parts: string[] = [];
    if (data.verdict) parts.push(data.verdict);
    const l5Rate = Number(data.last_5?.hitRate);
    if (Number.isFinite(l5Rate)) parts.push(`L5 hit rate: ${Math.round(l5Rate)}%`);
    const l10Rate = Number(data.last_10?.hitRate);
    if (Number.isFinite(l10Rate)) parts.push(`L10 hit rate: ${Math.round(l10Rate)}%`);
    const seasonRate = Number(data.season_hit_rate);
    if (Number.isFinite(seasonRate)) parts.push(`Season: ${Math.round(seasonRate)}%`);
    if (data.reasoning && Array.isArray(data.reasoning)) parts.push(...data.reasoning.slice(0, 2));

    return {
      confidence: Math.round(confidence),
      reasoning: parts.length > 0 ? parts.join(". ") + "." : `Model confidence: ${confidence}%`,
      avg_value: typeof seasonAvg === "number" ? seasonAvg : line,
      line: data.line ?? line,
      direction: data.recommended_direction || direction,
    };
  } catch (e) {
    console.error(`Prop model error ${player}:`, e);
    return null;
  }
}

// ── Use AI to scan full lineup and find best prop opportunities ──
async function getLineupPropSuggestions(
  players: Array<{ name: string; team: string; opponent: string }>,
  sport: string,
): Promise<Array<{ name: string; team: string; opponent: string; prop_type: string; line: number; direction: string }>> {
  if (players.length === 0) return [];

  // Only include prop types that the Odds API actually supports
  const sportPropTypes: Record<string, string> = {
    nba: "points, rebounds, assists, 3-pointers, steals, blocks, turnovers",
    mlb: "pitcher strikeouts, hits, home_runs, total_bases, rbi, runs",
    nhl: "goals, assists, points, shots_on_goal",
  };

  const playerList = players.map(p => `${p.name} (${p.team} vs ${p.opponent})`).join("\n");
  const propTypes = sportPropTypes[sport] || sportPropTypes.nba;

  try {
    const result = await callAI({
      fnName: "daily-picks",
      messages: [
        {
          role: "system",
          content: `You are an expert ${sport.toUpperCase()} betting analyst. Given the FULL active lineup for today's game, identify which 4-5 players across the ENTIRE roster have the best prop opportunities. Don't just pick star players — consider matchup advantages, recent form, role changes, backup players getting extra minutes, and platoon advantages. Available prop types: ${propTypes}. ${ANTI_GENERIC_INSTRUCTION}`,
        },
        {
          role: "user",
          content: `Today's ${sport.toUpperCase()} active lineup:\n${playerList}\n\nIdentify the 4-5 best prop opportunities across this roster. Include role players if they have a strong edge.`,
        },
      ],
      tool: {
        name: "suggest_props",
        description: `Suggest the best prop bets from the full ${sport.toUpperCase()} lineup`,
        parameters: {
          type: "object",
          properties: {
            props: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  prop_type: { type: "string" },
                  line: { type: "number" },
                  direction: { type: "string", enum: ["over", "under"] },
                },
                required: ["name", "prop_type", "line", "direction"],
              },
            },
          },
          required: ["props"],
        },
      },
    });

    const parsed = result.output as { props: any[] };
    return (parsed.props || []).map((s: any) => {
      const player = players.find(p =>
        p.name.toLowerCase().includes(s.name?.toLowerCase()) ||
        s.name?.toLowerCase().includes(p.name?.toLowerCase())
      );
      return {
        name: s.name,
        team: player?.team || "",
        opponent: player?.opponent || "",
        prop_type: s.prop_type,
        line: s.line,
        direction: s.direction,
      };
    }).filter((s: any) => s.team);
  } catch (e) {
    console.error(`AI lineup scan error (${sport}):`, e);
    return [];
  }
}

// ── Rank games by anticipation using AI ──
async function rankGamesByAnticipation(
  games: GameInfo[],
): Promise<GameInfo[]> {
  if (games.length <= 6) return games; // No need to rank small lists

  const gameList = games.map((g, i) => `${i}: ${g.away} @ ${g.home} (${g.sport.toUpperCase()})`).join("\n");

  try {
    const result = await callAI({
      fnName: "daily-picks",
      messages: [
        {
          role: "system",
          content: `You are a sports betting analyst. Rank the given games by anticipated betting interest and viewership. Consider: playoff implications, rivalry matchups, marquee teams/stars, national TV broadcasts, competitive balance, and division/conference standings impact. Return indices from most to least anticipated. ${ANTI_GENERIC_INSTRUCTION}`,
        },
        {
          role: "user",
          content: `Rank these games by most anticipated for betting:\n${gameList}`,
        },
      ],
      tool: {
        name: "rank_games",
        description: "Return game indices ranked by anticipation, most anticipated first",
        parameters: {
          type: "object",
          properties: {
            ranked_indices: {
              type: "array",
              items: { type: "number" },
              description: "Array of game indices from most to least anticipated",
            },
          },
          required: ["ranked_indices"],
          additionalProperties: false,
        },
      },
    });

    const parsed = result.output as { ranked_indices: number[] };
    const indices: number[] = parsed.ranked_indices || [];

    // Build ranked list, then append any missing games
    const ranked: GameInfo[] = [];
    const seen = new Set<number>();
    for (const idx of indices) {
      if (typeof idx === "number" && idx >= 0 && idx < games.length && !seen.has(idx)) {
        ranked.push(games[idx]);
        seen.add(idx);
      }
    }
    // Append any games the AI missed
    for (let i = 0; i < games.length; i++) {
      if (!seen.has(i)) ranked.push(games[i]);
    }

    console.log(`🏆 AI ranked ${ranked.length} games. Top 3: ${ranked.slice(0, 3).map(g => `${g.away}@${g.home}`).join(", ")}`);
    return ranked;
  } catch (e) {
    console.error("AI ranking error, falling back to original order:", e);
    return games;
  }
}

// ── Supported prop types per sport (deterministic, both directions graded) ──
const SPORT_PROP_TYPES: Record<string, string[]> = {
  nba: ["points", "rebounds", "assists", "3-pointers", "steals", "blocks", "turnovers"],
  mlb: ["strikeouts", "hits", "home_runs", "total_bases", "rbi", "runs"],
  nhl: ["goals", "assists", "points", "shots_on_goal"],
};

const PLAYERS_PER_GAME_CAP = 12;

function parseOdds(odds: string | null | undefined): number {
  if (!odds || odds === "N/A") return -110;
  const n = parseInt(String(odds).replace("+", ""));
  return Number.isFinite(n) ? n : -110;
}

import { score, rankAndDistribute, type ScoredPlay } from "../_shared/edge_scoring.ts";
import { americanToImplied, fairImpliedFromPair, calcEvPct, clamp01 } from "../_shared/prob_math.ts";
import { getCalibration } from "../_shared/calibration_cache.ts";
// Back-compat aliases so existing local references keep working unchanged.
const americanToImpliedProb = americanToImplied;
const calcEv = calcEvPct;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Run lock: prevent concurrent invocations from creating duplicates ──
  const lockDate = new Date().toISOString().slice(0, 10);
  let acquiredLock = false;
  try {
    // Stale-lock recovery: clear locks older than 10 minutes
    await supabase
      .from("daily_picks_runs")
      .delete()
      .lt("started_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    const { data: lockRow, error: lockErr } = await supabase
      .from("daily_picks_runs")
      .insert({ date: lockDate })
      .select()
      .maybeSingle();

    if (lockErr || !lockRow) {
      console.log(`🔒 Another daily-picks run is in flight for ${lockDate} — exiting early`);
      return new Response(
        JSON.stringify({ message: "Another run in progress", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    acquiredLock = true;
  } catch (e) {
    console.error("Lock acquisition error (continuing without lock):", e);
  }

  try {
    const startTime = Date.now();
    const TIMEOUT_MS = 140_000;
    const isTimedOut = () => Date.now() - startTime > TIMEOUT_MS;

    console.log("🎯 Daily picks generator — DETERMINISTIC FULL-SLATE SCAN");

    // ── Phase 1: Fetch all games across all sports ──
    const allGamesResults = await Promise.allSettled(
      Object.keys(ESPN_SPORTS).map(sport => getGamesForSport(sport))
    );
    const allGames: GameInfo[] = [];
    allGamesResults.forEach(r => {
      if (r.status === "fulfilled") allGames.push(...r.value);
    });

    if (!allGames.length) {
      console.log("No games today across any sport");
      return new Response(JSON.stringify({ message: "No games today", picks: [], count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`📋 Slate: ${allGames.length} games across ${Object.keys(ESPN_SPORTS).length} sports`);

    const rawPicks: any[] = [];

    // ── Phase A: Grade all game-level markets for every game ──
    console.log(`Phase A: scanning ${allGames.length} games`);
    for (let gi = 0; gi < allGames.length; gi++) {
      const game = allGames[gi];
      if (isTimedOut()) { console.log("⏱️ Timeout — stopping Phase A"); break; }
      try {
        const picks = await retryWithBackoff(
          () => analyzeGameBets(game, supabaseUrl, serviceKey, 0),
          2, `game-${game.away}@${game.home}`
        );
        rawPicks.push(...picks);
      } catch (e) { console.error(`Phase A error:`, e); }
      if (gi < allGames.length - 1) await delay(700);
    }
    console.log(`Phase A done: ${rawPicks.length} game candidates (${Math.round((Date.now() - startTime) / 1000)}s)`);

    // ── Phase B: Grade all active players, both directions ──
    console.log("Phase B: scanning lineups for player props");
    const lineupResults = await Promise.allSettled(
      allGames.map(game => getGameLineup(game.gameId, game.sport).then(lineup => ({ game, lineup })))
    );

    for (const r of lineupResults) {
      if (isTimedOut()) { console.log("⏱️ Timeout — stopping Phase B"); break; }
      if (r.status !== "fulfilled" || r.value.lineup.length === 0) continue;
      const { game, lineup } = r.value;
      const propTypes = SPORT_PROP_TYPES[game.sport] || [];
      if (propTypes.length === 0) continue;

      const players = lineup.slice(0, PLAYERS_PER_GAME_CAP);

      for (const player of players) {
        if (isTimedOut()) break;
        for (const propType of propTypes) {
          if (isTimedOut()) break;
          for (const direction of ["over", "under"] as const) {
            if (isTimedOut()) break;
            try {
              const result = await analyzePlayerProp(
                player.name, propType, 0, direction, player.opponent, game.sport, supabaseUrl, serviceKey
              );
              if (!result || !result.line || result.line <= 0) continue;
              const realOdds = await fetchRealOdds(player.name, propType, result.direction, game.sport, supabaseUrl, serviceKey);
              if (!realOdds) continue;
              rawPicks.push({
                bet_type: "prop",
                player_name: player.name,
                team: player.team,
                opponent: player.opponent,
                home_team: null,
                away_team: null,
                prop_type: propType,
                line: result.line,
                direction: result.direction,
                hit_rate: result.confidence,
                avg_value: result.avg_value,
                reasoning: result.reasoning,
                odds: realOdds,
                spread_line: null,
                total_line: null,
                sport: game.sport,
              });
            } catch (e) {
              console.error(`prop err ${player.name}/${propType}/${direction}:`, e);
            }
            await delay(120);
          }
        }
      }
    }
    console.log(`Phase B done: ${rawPicks.length} total candidates (${Math.round((Date.now() - startTime) / 1000)}s)`);

    // ── Phase C: Score, rank, gate strictly ──
    // Sanity filter: drop any candidate where the model<>market gap is mathematically impossible
    // (>40% probability gap usually means we stapled an alt-line price to a different graded line)
    const sanePicks = rawPicks.filter(p => {
      const oddsNum = parseOdds(p.odds);
      // Hard cap: no +500 or longer in the candidate pool at all
      if (oddsNum >= 500) return false;
      // Pre-calibration sanity gap check. We use the RAW confidence here
      // because calibration only compresses extremes; a 40% gap to fair
      // implied prob pre-calibration is still almost always a mispaired
      // alt-line → graded-line staple bug.
      const projectedProb = clamp01((p.hit_rate || 0) / 100);
      const impliedProb = p.odds_opp != null
        ? fairImpliedFromPair(oddsNum, parseOdds(p.odds_opp))
        : americanToImpliedProb(oddsNum);
      if (Math.abs(projectedProb - impliedProb) > 0.40) return false;
      return true;
    });
    // Per-(player, prop_type) dedupe: keep the strongest direction only
    const bestByKey = new Map<string, any>();
    for (const p of sanePicks) {
      const k = `${p.sport}|${p.player_name}|${p.prop_type}`;
      const prev = bestByKey.get(k);
      if (!prev || (p.hit_rate || 0) > (prev.hit_rate || 0)) bestByKey.set(k, p);
    }
    const dedupedPicks = Array.from(bestByKey.values());
    console.log(`Phase C: ${rawPicks.length} raw → ${sanePicks.length} sane → ${dedupedPicks.length} deduped`);

    // ── v3: calibrate + de-vig inside score(). Raw confidence is the
    // pre-calibration factor-sum score (0-1 or 0-100). `odds_opp`, when
    // available, removes the book's juice before computing edge.
    // Calibration rows are cached 5 minutes per (sport, bet_type).
    const calibrationBySport = new Map<string, any>();
    async function calFor(sport: string, betType: string) {
      const k = `${sport}|${betType}`;
      if (!calibrationBySport.has(k)) {
        calibrationBySport.set(k, await getCalibration(sport, betType));
      }
      return calibrationBySport.get(k);
    }

    const scoredPlays: ScoredPlay[] = [];
    for (const p of dedupedPicks) {
      const oddsNum = parseOdds(p.odds);
      const oddsOpp = p.odds_opp != null ? parseOdds(p.odds_opp) : null;
      const betType = (p.bet_type === "over_under" ? "total" : p.bet_type) as
        "prop" | "moneyline" | "spread" | "total";
      const calibration = await calFor(p.sport, betType);
      scoredPlays.push(
        score({
          sport: p.sport,
          bet_type: betType,
          player_name: p.player_name,
          team: p.team,
          opponent: p.opponent,
          home_team: p.home_team,
          away_team: p.away_team,
          prop_type: p.prop_type,
          line: p.line,
          spread_line: p.spread_line,
          total_line: p.total_line,
          direction: p.direction,
          odds: oddsNum,
          odds_opp: oddsOpp,
          raw_confidence: Number(p.hit_rate || 0),
          calibration,
        }),
      );
    }

    const { todaysEdge, dailyPicks: dailyRanked, freePicks } = rankAndDistribute(scoredPlays);
    console.log(`✅ Gated: ${todaysEdge.length} edge, ${dailyRanked.length} daily, ${freePicks.length} free`);

    // ── Phase D: Persist ──
    const today = new Date().toISOString().slice(0, 10);
    const edgeKeySet = new Set(
      todaysEdge.map(p => `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`)
    );
    const findRaw = (sp: ScoredPlay) =>
      rawPicks.find(rp =>
        rp.sport === sp.sport &&
        rp.player_name === sp.player_name &&
        rp.prop_type === sp.prop_type &&
        rp.direction === sp.direction &&
        Number(rp.line) === Number(sp.line)
      );

    // Build rows in memory and write in ONE transaction via replace_daily_picks RPC.
    // This eliminates the "wipe succeeded + insert failed → empty carousel" race.
    const pickRows = dailyRanked.map(sp => {
      const raw = findRaw(sp);
      const key = `${sp.sport}|${sp.player_name}|${sp.prop_type}|${sp.direction}|${sp.line}`;
      const tier = edgeKeySet.has(key) ? "edge" : "daily";
      console.log(`✓ persist [${tier}] ${sp.sport}/${sp.player_name}/${sp.prop_type} ${sp.direction} ${sp.line} | conf=${sp.confidence.toFixed(3)} rel=${sp.reliability.toFixed(2)} edge=${sp.edge.toFixed(3)} odds=${sp.odds} verdict=${sp.verdict}`);
      return {
        pick_date: today,
        sport: sp.sport,
        player_name: sp.player_name,
        team: sp.team || null,
        opponent: sp.opponent || null,
        prop_type: sp.prop_type,
        line: sp.line,
        direction: sp.direction,
        hit_rate: Math.round(sp.confidence * 100),
        last_n_games: 10,
        avg_value: raw?.avg_value ?? sp.line,
        reasoning: raw?.reasoning || sp.reasoning,
        odds: raw?.odds ?? (sp.odds > 0 ? `+${sp.odds}` : `${sp.odds}`),
        result: "pending",
        bet_type: sp.bet_type === "total" ? "over_under" : sp.bet_type,
        spread_line: sp.spread_line ?? null,
        total_line: sp.total_line ?? null,
        home_team: sp.home_team ?? null,
        away_team: sp.away_team ?? null,
        tier,
        status: null,
      };
    });

    // ── Empty-slate marker ──
    // If we generated zero Strong edge picks, insert a typed marker row
    // so the Home carousel can render a real empty-state instead of blank.
    if (todaysEdge.length === 0) {
      pickRows.push({
        pick_date: today,
        sport: "meta",
        player_name: "No Strong picks today",
        team: null,
        opponent: null,
        prop_type: "empty_slate",
        line: 0,
        direction: "n/a",
        hit_rate: 0,
        last_n_games: 0,
        avg_value: 0,
        reasoning: "No games cleared the Strong threshold. Check Daily Picks tab for Lean plays.",
        odds: "0",
        result: "pending",
        bet_type: "meta",
        spread_line: null,
        total_line: null,
        home_team: null,
        away_team: null,
        tier: "edge",
        status: "empty_slate",
      } as any);
    }

    const freeRows = freePicks
      .filter(sp => sp.bet_type === "prop")
      .map(sp => ({
        player_name: sp.player_name,
        team: sp.team || null,
        opponent: sp.opponent || null,
        prop_type: sp.prop_type,
        line: sp.line,
        direction: sp.direction,
        odds: Math.round(sp.odds),
        edge: Math.round(sp.edge * 1000) / 10,
        confidence: Math.round(sp.confidence * 1000) / 1000,
        sport: sp.sport,
        book: "model",
        prop_date: today,
      }));

    try {
      const { error: rpcErr } = await supabase.rpc("replace_daily_picks", {
        p_pick_date: today,
        p_rows: pickRows,
        p_free_rows: freeRows,
      });
      if (rpcErr) {
        console.error("replace_daily_picks RPC error:", rpcErr);
        // Fallback to the old wipe+upsert path — prevents total outage
        // if the migration hasn't been applied yet.
        await supabase.from("daily_picks").delete().eq("pick_date", today);
        await supabase.from("free_props").delete().eq("prop_date", today);
        if (pickRows.length > 0) {
          const { error: insertErr } = await supabase
            .from("daily_picks")
            .upsert(pickRows, {
              onConflict: "pick_date,sport,tier,player_name,prop_type,direction,line",
              ignoreDuplicates: true,
            });
          if (insertErr) console.error("daily_picks fallback upsert error:", insertErr);
        }
        if (freeRows.length > 0) {
          await supabase.from("free_props").insert(freeRows);
        }
      }
    } catch (e) {
      console.error("persist error:", e);
    }

    return new Response(
      JSON.stringify({
        message: "Picks generated — full-slate deterministic scan",
        count: dailyRanked.length,
        todays_edge: todaysEdge.length,
        free_picks: freePicks.length,
        scanned_games: allGames.length,
        raw_candidates: rawPicks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Daily picks error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } finally {
    if (acquiredLock) {
      try {
        await supabase.from("daily_picks_runs").delete().eq("date", lockDate);
      } catch (e) {
        console.error("Lock release error:", e);
      }
    }
  }
});
