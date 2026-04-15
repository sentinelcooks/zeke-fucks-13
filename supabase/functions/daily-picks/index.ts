import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
  confidenceThreshold: number = 70
): Promise<Array<{
  bet_type: string; player_name: string; team: string; opponent: string;
  home_team: string; away_team: string; prop_type: string; line: number;
  direction: string; hit_rate: number; avg_value: number; reasoning: string;
  odds: string; spread_line: number | null; total_line: number | null; sport: string;
}>> {
  const modelEndpoint = SPORT_MODEL_MAP[game.sport];
  if (!modelEndpoint) return [];

  const picks: any[] = [];
  const betTypes = game.sport === "nba" ? ["moneyline", "spread", "total"] : ["moneyline"];

  for (const betType of betTypes) {
    try {
      const analyzePath = modelEndpoint === "moneyline-api" ? "" : "/analyze";
      // moneyline-api expects home_team/away_team names; mlb-model/nhl-model expect team1_id/team2_id
      const bodyPayload = modelEndpoint === "moneyline-api"
        ? { home_team: game.home, away_team: game.away, bet_type: betType, sport: game.sport }
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

      // Fetch real market odds — skip pick if no real odds found
      const oddsTeamOrPlayer = betType === "total" ? `${game.away} @ ${game.home}` : playerName;
      const realOdds = data.odds || await fetchGameOdds(oddsTeamOrPlayer, pickBetType, game.sport, supabaseUrl, serviceKey);
      if (!realOdds) {
        console.log(`  ⚠️ No real odds for ${playerName} (${pickBetType}), skipping`);
        continue;
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
  LOVABLE_API_KEY: string
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
    const resp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an expert ${sport.toUpperCase()} betting analyst. Given the FULL active lineup for today's game, identify which 2-3 players across the ENTIRE roster have the best prop opportunities. Don't just pick star players — consider matchup advantages, recent form, role changes, backup players getting extra minutes, and platoon advantages. Available prop types: ${propTypes}.`
          },
          {
            role: "user",
            content: `Today's ${sport.toUpperCase()} active lineup:\n${playerList}\n\nIdentify the 2-3 best prop opportunities across this roster. Include role players if they have a strong edge.`
          }
        ],
        tools: [{
          type: "function",
          function: {
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
                      direction: { type: "string", enum: ["over", "under"] }
                    },
                    required: ["name", "prop_type", "line", "direction"]
                  }
                }
              },
              required: ["props"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "suggest_props" } },
      }),
    });

    if (!resp.ok) { await resp.text(); return []; }
    const data = await resp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return [];

    const parsed = JSON.parse(toolCall.function.arguments);
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
  LOVABLE_API_KEY: string
): Promise<GameInfo[]> {
  if (games.length <= 6) return games; // No need to rank small lists

  const gameList = games.map((g, i) => `${i}: ${g.away} @ ${g.home} (${g.sport.toUpperCase()})`).join("\n");

  try {
    const resp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "You are a sports betting analyst. Rank the given games by anticipated betting interest and viewership. Consider: playoff implications, rivalry matchups, marquee teams/stars, national TV broadcasts, competitive balance, and division/conference standings impact. Return indices from most to least anticipated."
          },
          {
            role: "user",
            content: `Rank these games by most anticipated for betting:\n${gameList}`
          }
        ],
        tools: [{
          type: "function",
          function: {
            name: "rank_games",
            description: "Return game indices ranked by anticipation, most anticipated first",
            parameters: {
              type: "object",
              properties: {
                ranked_indices: {
                  type: "array",
                  items: { type: "number" },
                  description: "Array of game indices from most to least anticipated"
                }
              },
              required: ["ranked_indices"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "rank_games" } },
      }),
    });

    if (!resp.ok) {
      console.warn("AI ranking failed, using original order");
      return games;
    }

    const data = await resp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return games;

    const parsed = JSON.parse(toolCall.function.arguments);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const startTime = Date.now();
    const TIMEOUT_MS = 120_000; // 120s guard, 30s buffer before edge fn limit
    const isTimedOut = () => Date.now() - startTime > TIMEOUT_MS;

    console.log("🎯 Daily picks generator started — multi-sport, multi-bet-type");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Phase 1: Fetch games across all sports ──
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
    console.log(`Found ${allGames.length} games across ${Object.keys(ESPN_SPORTS).length} sports`);

    // ── Rank games by anticipation using AI ──
    console.log("Ranking games by anticipation...");
    const rankedGames = await retryWithBackoff(() => rankGamesByAnticipation(allGames, LOVABLE_API_KEY), 3, "ranking");
    console.log(`⏱️ Ranking took ${Math.round((Date.now() - startTime) / 1000)}s`);

    const allPicks: any[] = [];

    // ── Phase 2: Game-level bets (Moneylines, Spreads, O/U) — top 12 ranked ──
    console.log("Phase 2: Analyzing game-level bets (ranked by anticipation)...");
    const gamesForBets = rankedGames.slice(0, 12);
    for (let gi = 0; gi < gamesForBets.length; gi++) {
      const game = gamesForBets[gi];
      if (isTimedOut()) { console.log("⏱️ Timeout approaching, stopping game bets"); break; }
      try {
        const picks = await retryWithBackoff(() => analyzeGameBets(game, supabaseUrl, serviceKey), 2, `game-${game.away}@${game.home}`);
        allPicks.push(...picks);
      } catch (e) { console.error(`Game bet error:`, e); }
      // Throttle between games to avoid rate limits on downstream model calls
      if (gi < gamesForBets.length - 1) await delay(1500);
    }
    console.log(`Phase 2 complete: ${allPicks.length} game-level picks (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    // ── Phase 3: Player props (lineup-based) — top 8 ranked ──
    if (!isTimedOut()) {
      console.log("Phase 3: Scanning lineups for prop opportunities (ranked by anticipation)...");
      const gamesToScan = rankedGames.slice(0, 8);
      const lineupResults = await Promise.allSettled(
        gamesToScan.map(game => getGameLineup(game.gameId, game.sport).then(lineup => ({ game, lineup })))
      );

      const propSuggestions: Array<{ name: string; team: string; opponent: string; prop_type: string; line: number; direction: string; sport: string }> = [];

      for (const r of lineupResults) {
        if (isTimedOut()) { console.log("⏱️ Timeout approaching, stopping lineup scan"); break; }
        if (r.status !== "fulfilled" || r.value.lineup.length === 0) continue;
        const { game, lineup } = r.value;
        const suggestions = await retryWithBackoff(() => getLineupPropSuggestions(lineup, game.sport, LOVABLE_API_KEY), 2, `lineup-${game.sport}`);
        propSuggestions.push(...suggestions.map(s => ({ ...s, sport: game.sport })));
        await delay(2000); // Throttle between AI lineup calls
      }

      console.log(`Got ${propSuggestions.length} lineup-based prop suggestions (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

      // Analyze props through model
      for (let i = 0; i < propSuggestions.length && i < 12; i += 4) {
        if (isTimedOut()) { console.log("⏱️ Timeout approaching, stopping prop analysis"); break; }
        const batch = propSuggestions.slice(i, i + 4);
        const results = await Promise.allSettled(
          batch.map(pl =>
            analyzePlayerProp(pl.name, pl.prop_type, pl.line, pl.direction, pl.opponent, pl.sport, supabaseUrl, serviceKey)
              .then(result => ({ pl, result }))
          )
        );

        for (const r of results) {
          if (r.status !== "fulfilled" || !r.value.result) continue;
          const { pl, result } = r.value;
          if (result.confidence >= 70) {
            const realOdds = await fetchRealOdds(pl.name, pl.prop_type, result.direction, pl.sport, supabaseUrl, serviceKey);
            if (!realOdds) { console.log(`  ⚠️ No real odds for ${pl.name} ${pl.prop_type}, skipping`); continue; }
            allPicks.push({
              bet_type: "prop",
              player_name: pl.name,
              team: pl.team,
              opponent: pl.opponent,
              home_team: null,
              away_team: null,
              prop_type: pl.prop_type,
              line: result.line,
              direction: result.direction,
              hit_rate: result.confidence,
              avg_value: result.avg_value,
              reasoning: result.reasoning,
              odds: realOdds,
              spread_line: null,
              total_line: null,
              sport: pl.sport,
            });
            console.log(`✅ ${pl.name} ${pl.prop_type}: ${result.confidence}% (odds: ${realOdds})`);
          }
        }

        if (allPicks.length >= 20) break;
      }
    } else {
      console.log("⏱️ Skipping Phase 3 — timeout approaching");
    }

    // ── Phase 3.5: Expansion — if fewer than 3 picks at 70%+, scan ALL remaining games at 65% ──
    const highConfPicks = allPicks.filter(p => p.hit_rate >= 70).length;
    if (highConfPicks < 3 && !isTimedOut()) {
      console.log(`⚠️ Only ${highConfPicks} high-confidence picks — expanding to ALL remaining games (65% threshold)`);

      // Expand game-level bets to remaining games (indices 12+)
      const remainingGamesForBets = rankedGames.slice(12);
      if (remainingGamesForBets.length > 0) {
        console.log(`Expansion: analyzing ${remainingGamesForBets.length} additional games for game-level bets`);
        for (const game of remainingGamesForBets) {
          if (isTimedOut() || allPicks.length >= 20) break;
          try {
            const picks = await analyzeGameBets(game, supabaseUrl, serviceKey, 65);
            allPicks.push(...picks);
          } catch (e) { console.error(`Expansion game bet error:`, e); }
        }
        console.log(`Expansion game bets done: ${allPicks.length} total picks (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      }

      // Expand prop scanning to remaining games (indices 8+)
      if (!isTimedOut() && allPicks.length < 20) {
        const remainingGamesForProps = rankedGames.slice(8);
        if (remainingGamesForProps.length > 0) {
          console.log(`Expansion: scanning ${remainingGamesForProps.length} additional games for player props`);
          const expansionLineups = await Promise.allSettled(
            remainingGamesForProps.map(game => getGameLineup(game.gameId, game.sport).then(lineup => ({ game, lineup })))
          );

          const expansionSuggestions: Array<{ name: string; team: string; opponent: string; prop_type: string; line: number; direction: string; sport: string }> = [];

          for (const r of expansionLineups) {
            if (isTimedOut()) break;
            if (r.status !== "fulfilled" || r.value.lineup.length === 0) continue;
            const { game, lineup } = r.value;
            const suggestions = await getLineupPropSuggestions(lineup, game.sport, LOVABLE_API_KEY);
            expansionSuggestions.push(...suggestions.map(s => ({ ...s, sport: game.sport })));
          }

          console.log(`Expansion: ${expansionSuggestions.length} prop suggestions (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

          for (let i = 0; i < expansionSuggestions.length && i < 12; i += 4) {
            if (isTimedOut() || allPicks.length >= 20) break;
            const batch = expansionSuggestions.slice(i, i + 4);
            const results = await Promise.allSettled(
              batch.map(pl =>
                analyzePlayerProp(pl.name, pl.prop_type, pl.line, pl.direction, pl.opponent, pl.sport, supabaseUrl, serviceKey)
                  .then(result => ({ pl, result }))
              )
            );

            for (const r of results) {
              if (r.status !== "fulfilled" || !r.value.result) continue;
              const { pl, result } = r.value;
              if (result.confidence >= 65) {
                const realOdds = await fetchRealOdds(pl.name, pl.prop_type, result.direction, pl.sport, supabaseUrl, serviceKey);
                if (!realOdds) { console.log(`  ⚠️ No real odds for ${pl.name} ${pl.prop_type}, skipping`); continue; }
                allPicks.push({
                  bet_type: "prop",
                  player_name: pl.name,
                  team: pl.team,
                  opponent: pl.opponent,
                  home_team: null,
                  away_team: null,
                  prop_type: pl.prop_type,
                  line: result.line,
                  direction: result.direction,
                  hit_rate: result.confidence,
                  avg_value: result.avg_value,
                  reasoning: result.reasoning,
                  odds: realOdds,
                  spread_line: null,
                  total_line: null,
                  sport: pl.sport,
                });
                console.log(`✅ Expansion: ${pl.name} ${pl.prop_type}: ${result.confidence}% (odds: ${realOdds})`);
              }
            }
          }
        }
      }

      console.log(`Expansion complete: ${allPicks.length} total picks (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    }

    // ── Phase 4: Insert all picks ──
    allPicks.sort((a, b) => b.hit_rate - a.hit_rate);
    const topPicks = allPicks.slice(0, 20);
    console.log(`Total: ${topPicks.length} picks (game-level + props)`);

    if (topPicks.length > 0) {
      const today = new Date().toISOString().split("T")[0];

      // Delete today's existing picks across all sports
      await supabase.from("daily_picks").delete().eq("pick_date", today);

      const { error: insertErr } = await supabase.from("daily_picks").insert(
        topPicks.map(p => ({
          pick_date: today,
          sport: p.sport,
          player_name: p.player_name,
          team: p.team,
          opponent: p.opponent,
          prop_type: p.prop_type,
          line: p.line,
          direction: p.direction,
          hit_rate: p.hit_rate,
          last_n_games: 10,
          avg_value: p.avg_value,
          reasoning: p.reasoning,
          odds: p.odds,
          result: "pending",
          bet_type: p.bet_type,
          spread_line: p.spread_line,
          total_line: p.total_line,
          home_team: p.home_team,
          away_team: p.away_team,
        }))
      );
      if (insertErr) { console.error("Insert error:", insertErr); throw insertErr; }

      // Sync prop picks to free_props
      const propPicks = topPicks.filter(p => p.bet_type === "prop");
      if (propPicks.length > 0) {
        await supabase.from("free_props").delete().eq("prop_date", today);
        await supabase.from("free_props").insert(
          propPicks.map(p => ({
            player_name: p.player_name, team: p.team, opponent: p.opponent,
            prop_type: p.prop_type, line: p.line, direction: p.direction,
            odds: parseInt(p.odds) || null, edge: 0, confidence: p.hit_rate,
            sport: p.sport, book: "model", prop_date: today,
          }))
        );
      }
    }

    return new Response(
      JSON.stringify({ message: "Picks generated — multi-sport", count: topPicks.length, picks: topPicks }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Daily picks error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
