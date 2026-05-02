import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, AIProviderError, ANTI_GENERIC_INSTRUCTION } from "../_shared/ai-provider.ts";
import { formatPropTypeServer, stripPropCodes } from "../_shared/format_labels.ts";

// Risk section must contain risk factors only — unit sizing comes from the
// Overall Verdict (decision.recommended_units), never from the AI text.
const UNIT_SIZING_RE = /(?:recommended\s+sizing|unit\s+sizing|sized\s+at|wager|stake|proceed\s+at|bet\s+size)[^.?!]*(?:units?|u)\.?/gi;
const TRAILING_UNITS_RE = /\b\d+(?:\.\d+)?\s*(?:units?|u)\b\.?/gi;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── Truncate a section to ~100 words ── */
function truncateSection(text: string, maxChars = 500): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSentence = cut.lastIndexOf('.');
  return lastSentence > 100 ? cut.slice(0, lastSentence + 1) : cut + '…';
}

/* ── Multi-format section parser ── */
function parseSections(content: string): { title: string; content: string }[] {
  const cleanMd = (t: string) => t.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "").trim();

  // Strategy 1: **Title**: body
  let sections = parseWithRegex(content, /\*\*([^*]+)\*\*\s*:?\s*/g, cleanMd);
  if (sections.length >= 2) return sections;

  // Strategy 2: ### Title or ## Title
  sections = parseWithRegex(content, /^#{2,3}\s+(.+)$/gm, cleanMd);
  if (sections.length >= 2) return sections;

  // Strategy 3: Numbered patterns like "1. Title:" or "1) Title:"
  sections = parseWithRegex(content, /^\d+[.)]\s*([^:\n]+):\s*/gm, cleanMd);
  if (sections.length >= 2) return sections;

  // Strategy 4: Split on double newlines
  const chunks = content.split(/\n\n+/).filter(c => c.trim().length > 0);
  return chunks.slice(0, 3).map(c => ({ title: "", content: truncateSection(cleanMd(c)) }));
}

function parseWithRegex(
  content: string,
  regex: RegExp,
  cleanMd: (t: string) => string
): { title: string; content: string }[] {
  const matches: { title: string; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    matches.push({
      title: m[1].replace(/^\d+[.)]\s*/, "").trim(),
      index: m.index,
      end: m.index + m[0].length,
    });
  }

  const sections: { title: string; content: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const body = truncateSection(cleanMd(content.slice(start, end)));
    if (matches[i].title && body) {
      sections.push({ title: matches[i].title, content: body });
    }
  }
  return sections;
}

/* ── Sport-specific injury instructions ── */
function getInjuryInstructions(sport: string): string {
  const s = (sport || "").toLowerCase();
  if (s === "mlb") return `CRITICAL INSTRUCTIONS — READ CAREFULLY:
- When a team is missing key hitters from the lineup, analyze how lineup protection changes: who bats around this player now, does he see more fastballs or get pitched around?
- For pitchers: if the bullpen is depleted, the starter may pitch deeper. If the lineup is weakened, run support drops.
- Platoon advantages shift when backup players enter — check L/R splits.
- Do NOT reference minutes, shot attempts, or per-36 stats. This is baseball.`;
  if (s === "nhl") return `CRITICAL INSTRUCTIONS — READ CAREFULLY:
- When a team is missing forwards, remaining players get more ice time and power-play promotion.
- Analyze line combinations: who moves up to the top-6? Does the PP1 unit change?
- For defensemen out, remaining D-men log heavier minutes and may see more shots on goal.
- Do NOT reference minutes in a basketball sense. Use TOI (time on ice), shifts, and zone starts.`;
  // NBA / default
  return `CRITICAL INSTRUCTIONS — READ CAREFULLY:
- When a team is missing multiple key players (3+), their historical stats are MEANINGLESS. Do NOT cite season averages or hit rates as reasons to fade.
- Instead, analyze HOW the remaining player's role changes: more minutes, more shot attempts, primary ball-handler duties, etc.
- A player who averaged 12 minutes and 8 points can easily put up 25+ when they become the only viable scorer on a depleted roster.
- Use per-36 or per-minute stats as a better projection basis than raw season averages.
- Be DECISIVE about injury impact. If 4+ teammates are out, this player IS the offense — act accordingly.
- The absence of key players fundamentally changes the player's expected output. Historical data from when those players were active is NOT predictive.`;
}

/* ── Sport-specific "without teammates" labels ── */
function getWithoutTeammatesLabels(sport: string) {
  const s = (sport || "").toLowerCase();
  if (s === "mlb") return { projLabel: "Projected plate appearances", perLabel: "Per-PA projection" };
  if (s === "nhl") return { projLabel: "Projected ice time", perLabel: "Per-60 projection" };
  return { projLabel: "Projected minutes tonight", perLabel: "Per-36 projection" };
}

/* ── Build pace context string for prompts ── */
function buildPaceContextString(paceContext: any, sport: string): string {
  if (!paceContext) return "";
  const t = paceContext.team;
  const o = paceContext.opponent;
  if (!t && !o) return "";
  
  let s = "\n\nGAME PACE / TOTAL CONTEXT:";
  if (sport === "nba") {
    if (t?.pace) s += `\n${t.team}: Pace ${t.pace}, ${t.ppg} PPG, OffRtg ${t.offRtg}, DefRtg ${t.defRtg}`;
    if (o?.pace) s += `\n${o.team}: Pace ${o.pace}, ${o.ppg} PPG, OffRtg ${o.offRtg}, DefRtg ${o.defRtg}`;
    if (t?.ppg && o?.ppg) s += `\nProjected game total: ~${Math.round(((t.ppg || 0) + (o.ppg || 0)) * 10) / 10}`;
  } else if (sport === "nhl") {
    if (t?.goalsFor) s += `\n${t.team}: ${t.goalsFor} GF/G, ${t.goalsAgainst} GA/G, ${t.shotsPerGame} SOG/G`;
    if (o?.goalsFor) s += `\n${o.team}: ${o.goalsFor} GF/G, ${o.goalsAgainst} GA/G, ${o.shotsPerGame} SOG/G`;
    if (t?.goalsFor && o?.goalsFor) s += `\nProjected game total: ~${Math.round(((t.goalsFor || 0) + (o.goalsFor || 0)) * 10) / 10}`;
  } else if (sport === "mlb") {
    if (t?.runsPerGame) s += `\n${t.team}: ${t.runsPerGame} R/G, ${t.battingAvg} AVG, ${t.ops} OPS`;
    if (o?.runsPerGame) s += `\n${o.team}: ${o.runsPerGame} R/G, ${o.battingAvg} AVG, ${o.ops} OPS`;
    if (t?.runsPerGame && o?.runsPerGame) s += `\nProjected game total: ~${Math.round(((t.runsPerGame || 0) + (o.runsPerGame || 0)) * 10) / 10} runs`;
  }
  return s;
}

/* ── Infer whether H2H games are from an active playoff series ── */
function inferPlayoffContext(h2hGames: any[] | undefined, opponent: string | undefined): string | null {
  if (!h2hGames?.length || !opponent) return null;
  const now = new Date();
  const cutoff = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const recentGames = h2hGames.filter((g: any) => g.date && new Date(g.date) > cutoff);
  if (recentGames.length === h2hGames.length && h2hGames.length >= 3) {
    return `NOTE: All ${h2hGames.length} meetings vs ${opponent} appear to be from the current 2025 playoff series.`;
  }
  return null;
}

/* ── Build rich context string from actual game data ── */
function buildRichContextString(body: any): string {
  const { h2hData, recentGameValues, line, overUnder } = body;
  const parts: string[] = [];

  if (Array.isArray(recentGameValues) && recentGameValues.length > 0) {
    const l10 = recentGameValues.slice(-10);
    const l10Avg = (l10.reduce((a: number, b: number) => a + b, 0) / l10.length).toFixed(1);
    const mostRecent = l10[l10.length - 1];
    const l10Hits = line != null
      ? l10.filter((v: number) => overUnder === "UNDER" ? v < line : v > line).length
      : null;
    const l10HitPct = l10Hits != null ? Math.round((l10Hits / l10.length) * 100) : null;
    let block = `RECENT FORM DATA:\nL10 stat values (oldest→newest): ${l10.join(", ")}\nL10 average: ${l10Avg}`;
    if (l10HitPct != null) block += `\nL10 hit rate: ${l10Hits}/${l10.length} (${l10HitPct}%) ${overUnder || "OVER"} ${line}`;
    block += `\nMost recent: ${mostRecent}`;
    parts.push(block);
  }

  if (h2hData) {
    const { games, opponent, rate, hits, total, avg } = h2hData;
    if (Array.isArray(games) && games.length > 0) {
      const statVals = games
        .map((g: any) => typeof g.stat_value === "number" ? g.stat_value : null)
        .filter((v: any): v is number => v !== null);
      if (statVals.length > 0) {
        const h2hFloor = Math.min(...statVals);
        const h2hCeiling = Math.max(...statVals);
        const playoffNote = inferPlayoffContext(games, opponent);
        let block = `H2H vs ${opponent || "Opponent"} (${games.length} games):\nValues most recent first: ${statVals.join(", ")}`;
        if (rate != null && hits != null && total != null)
          block += `\nH2H hit rate: ${hits}/${total} (${Math.round(rate)}%) ${overUnder || "OVER"} ${line}`;
        if (avg != null) block += `, average ${avg}`;
        block += `\nH2H floor: ${h2hFloor}, ceiling: ${h2hCeiling}`;
        if (playoffNote) block += `\n${playoffNote}`;
        parts.push(block);
      }
    } else if (avg != null) {
      let block = `H2H vs ${opponent || "Opponent"}:\nH2H average: ${avg}`;
      if (rate != null) block += `, hit rate: ${Math.round(rate)}%`;
      parts.push(block);
    }
  }

  return parts.length > 0
    ? "\n\nACTUAL GAME DATA (USE THESE SPECIFIC NUMBERS):\n" + parts.join("\n\n")
    : "";
}

/* ── Sport-specific prop prompts ── */
function getPropPrompt(body: any, injurySection: string, teammatesSection: string): string {
  const { playerOrTeam, overUnder, line, verdict, confidence, sport } = body;
  const propDisplay = formatPropTypeServer(body.propDisplay) || body.propDisplay || "";
  const dataPointsRaw = (body.reasoning || body.factors || []).join("\n- ");
  const dataPoints = stripPropCodes(dataPointsRaw);
  const s = (sport || "").toLowerCase();

  const richContext = buildRichContextString(body);

  const formatRule = `Write exactly 5 sections. Each MUST be 3-5 sentences and under 100 words. NO EXCEPTIONS — output is auto-truncated.
Format each as: **Section Title**: plain text analysis.
Do NOT use markdown inside the text — no asterisks, no bold, no bullets. Only the title is wrapped in **.`;

  const directionInstruction = (overUnder || "OVER").toUpperCase() === "UNDER"
    ? `Direction: UNDER ${line}. Explain why ${playerOrTeam} is likely to stay BELOW this line, not why they exceed it.`
    : `Direction: OVER ${line}. Explain the realistic path for ${playerOrTeam} to clear this line.`;

  const antiHype = `AVOID these phrases: "checks the boxes", "lock", "free money", "guaranteed", "smash", "easy", "must bet". PREFER neutral phrasing: "The case is strongest through...", "The main risk is...", "This is more of a lean than a full edge if..."
Only reference values included in the context above. Never create or estimate missing game-log values.`;

  const overallRating = body.overallRating || "";
  const ratingInstruction = overallRating === "fade"
    ? `The overall verdict is FADE. Do NOT recommend betting. Acknowledge the risks clearly.`
    : overallRating === "lean"
      ? `The overall verdict is LEAN. Be cautiously optimistic. Mention it's a small-unit play with caveats.`
      : overallRating === "take"
        ? `The overall verdict is TAKE. Be assertive and confident. Recommend the bet clearly.`
        : `Your final verdict MUST ALIGN with "${verdict}".`;

  const paceStr = buildPaceContextString(body.paceContext, s);

  if (s === "mlb") return `You are a sharp MLB betting analyst. Be concise and data-driven. Use baseball terminology throughout.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Data points:
- ${dataPoints || "No additional data"}${paceStr}${richContext}${injurySection}${teammatesSection}

CRITICAL: ${ratingInstruction} Never contradict the overall rating.
${directionInstruction}
${antiHype}

${formatRule}

1. Statistical Edge — Season hit rate, sample size, L10 and L5 trend; platoon splits, K rate / ERA / WHIP / OPS supporting ${overUnder || "OVER"} ${line || "N/A"} ${propDisplay || ""}. Use specific numbers from the data.
2. Matchup / Context — Opposing pitcher/hitter matchup, park dimensions, weather, bullpen state. Reference opponent H2H history if provided.${paceStr ? " Factor in game pace/total context." : ""}
3. Recent Form — Use actual values from the game data block above. State the most recent value, L10 floor, and ceiling explicitly. Do not estimate any value not in the data.
4. Line Value — Compare the line to season avg, L10 avg, and H2H avg. State the floor cushion above or below the line and any variance risk.
5. Risk — Name ONE specific risk factor (opposing pitcher form, park, lineup spot, weather) that could kill this pick. Risk factors only. DO NOT recommend a unit size, mention "u" or "units".`;

  if (s === "nhl") return `You are a sharp NHL betting analyst. Be concise and data-driven. Use hockey terminology throughout.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Data points:
- ${dataPoints || "No additional data"}${paceStr}${richContext}${injurySection}${teammatesSection}

CRITICAL: ${ratingInstruction} Never contradict the overall rating.
${directionInstruction}
${antiHype}

${formatRule}

1. Statistical Edge — Season hit rate, sample size, L10 trend; Shots on Goal trends, shooting %, TOI, PP1/PP2 placement supporting ${overUnder || "OVER"} ${line || "N/A"} ${propDisplay || ""}. Use specific numbers.
2. Matchup / Context — Opposing goalie save %, line combinations, PP/PK time, fatigue. Reference opponent H2H history and any series note if provided.${paceStr ? " Factor in game pace/total context." : ""}
3. Recent Form — Use actual values from the game data block above. State the most recent value, L10 floor, and ceiling. Do not estimate any value not in the data.
4. Line Value — Compare the line to season avg, L10 avg, and H2H avg. State the floor cushion above or below the line.
5. Risk — Name ONE specific risk factor (opposing goalie, line/PP demotion, TOI volatility, low team total) that could kill this pick. Risk factors only. DO NOT recommend a unit size, mention "u" or "units".`;

  // NBA / UFC / default
  return `You are a sharp sports betting analyst. Be concise, data-driven, and specific to this pick.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%
Sport: ${sport || "nba"}

Data points:
- ${dataPoints || "No additional data"}${paceStr}${richContext}${injurySection}${teammatesSection}

CRITICAL: ${ratingInstruction} Never contradict the overall rating.
${directionInstruction}
${antiHype}

${formatRule}

1. Statistical Edge — Season hit rate and sample size; L10 and L5 trend; usage and minutes trends supporting ${overUnder || "OVER"} ${line || "N/A"} ${propDisplay || ""}. Use specific numbers.
2. Matchup / Context — Opponent defensive profile vs this prop type, pace, any series context. Reference opponent H2H history and series note if provided.${paceStr ? " Use the game pace/total context provided." : ""}
3. Recent Form — Use actual values from the game data block above. State the most recent value, L10 floor, and ceiling. Do not estimate any value not in the data.
4. Line Value — Compare the line to season avg, L10 avg, and H2H avg. State the cushion above (OVER) or margin of safety below (UNDER) the line explicitly.
5. Risk — Name ONE specific risk factor (injury, blowout risk, tight cushion, pace shift) that could kill this pick. Risk factors only. DO NOT recommend a unit size, mention "u" or "units".`;
}

/* ── Sport-specific system messages ── */
function getSystemMessage(sport: string, type: string): string {
  const s = (sport || "").toLowerCase();

  if (type === "prop") {
    const propBase = "STRICT RULES: Write exactly 5 sections. Each section MUST be 3-5 sentences and under 100 words. No markdown inside text. Only use **Title**: format for section headers. Only cite numbers that appear in the provided data — never invent statistics.";
    if (s === "ufc") return `You are an expert MMA betting analyst. Be concise. Never hedge — take a clear stance. Use specific numbers from the data. ${propBase}`;
    if (s === "nhl") return `You are an expert NHL betting analyst. Be concise. Never hedge. Use hockey terminology: save %, GAA, puck line, PP, PK, Shots on Goal, Corsi, TOI. ${propBase}`;
    if (s === "mlb") return `You are an expert MLB betting analyst. Be concise. Never hedge. Use baseball terminology: ERA, WHIP, K/9, OPS, wOBA, park factor. ${propBase}`;
    return `You are an expert sports betting analyst. Be concise. Never hedge — take a clear stance. Current injuries matter MORE than historical data. ${propBase}`;
  }

  // Moneyline / spread / total: keep original 3-section, 50-word rules
  const base = "STRICT RULES: Each section MUST be 2-3 sentences and under 50 words. No exceptions. No paragraphs. No markdown inside text. Only use **Title**: format for section headers. Output that exceeds 50 words per section will be auto-truncated.";
  if (s === "ufc") return `You are an expert MMA betting analyst. Be concise. Never hedge — take a clear stance. Use specific numbers. ${base}`;
  if (s === "nhl") return `You are an expert NHL betting analyst. Be concise. Never hedge — take a clear stance. Use hockey terminology: save %, GAA, puck line, PP, PK, SOG, Corsi, TOI. ${base}`;
  if (s === "mlb") return `You are an expert MLB betting analyst. Be concise. Never hedge — take a clear stance. Use baseball terminology: ERA, WHIP, K/9, OPS, wOBA, park factor. ${base}`;
  return `You are an expert sports betting analyst. Be concise. Never hedge — take a clear stance. Current injuries matter MORE than historical data. ${base}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type, verdict, confidence, playerOrTeam, line, propDisplay, overUnder, reasoning, factors, injuries, sport, withoutTeammatesData, overallRating, overallSummary: overallSummaryText, decision, team1Name, team2Name, oddsAmerican } = body;

    const dataPoints = (reasoning || factors || []).join("\n- ");
    const sportLower = (sport || "nba").toLowerCase();

    // ── Humanize tier label so "noBet" never leaks to the LLM ──
    const tierToHuman = (t: string): string => {
      switch (t) {
        case "veryHigh": return "very high conviction";
        case "high": return "high conviction";
        case "medium": return "medium conviction";
        case "low": return "lean (small play)";
        case "noBet": return "pass — line doesn't meet our confidence threshold";
        default: return "neutral";
      }
    };

    const passReasonToHuman = (r?: string | null): string => {
      if (r === "toss_up") return "the matchup grades as a toss-up — neither side has a meaningful edge";
      if (r === "negative_edge") return "the market price already implies more than our model gives this side";
      return "the model's conviction does not clear our threshold for a sized play";
    };

    // ── LOCKED PICK BLOCK — sport-agnostic, prepended to every prompt ──
    const matchupLine = (team1Name && team2Name)
      ? `${team1Name} vs ${team2Name}${line != null ? ` — line ${line}` : ""}${oddsAmerican != null ? ` at ${oddsAmerican > 0 ? "+" : ""}${oddsAmerican}` : ""}`
      : (playerOrTeam || "");

    const lockedPickBlock = decision && decision.winning_team_name
      ? (decision.recommended_units > 0
          ? `\n\nLOCKED PICK (DO NOT CONTRADICT — THIS IS THE FINAL DECISION):
- Matchup: ${matchupLine}
- Side: ${decision.winning_team_name}
- Conviction: ${tierToHuman(decision.conviction_tier)}
- Win probability: ${decision.win_probability}%
- Edge over market: ${decision.edge ?? "n/a"}%

ABSOLUTE RULES:
1. You MUST write rationale supporting THIS pick. Do NOT recommend the opposite side.
2. Reference the specific matchup (${matchupLine}) by name — do NOT write generic copy.
3. The "Risk" section is RISK FACTORS ONLY. Do NOT mention unit sizing, "X units on Y", "u", or "units" anywhere — sizing is rendered separately in the Overall Verdict block from the structured decision.
4. Never reference the losing side as the recommended play. Never use the phrase "noBet" or "noBet tier".\n`
          : `\n\nLOCKED PICK (DO NOT CONTRADICT — THIS IS A PASS):
- Matchup: ${matchupLine}
- Recommendation: PASS on this line
- Reason: ${passReasonToHuman(decision.pass_reason)}
- Model probability: ${decision.win_probability}%${decision.edge != null ? `, edge: ${decision.edge}%` : ""}

ABSOLUTE RULES:
1. This is a PASS. Do NOT push either side. Do NOT write "0 units on [team]".
2. In your final "Risk" section, name a matchup-specific risk that explains why this is a pass — e.g., "Passing on ${matchupLine} — [reason]". Risk factors only. NEVER mention unit sizing, "u", or "units".
3. Never use the phrases "noBet", "noBet tier", "0 units on", or any internal model labels.
4. Be specific to this matchup — reference team names, recent form, or injury state. Do NOT write generic template copy.\n`)
      : "";


    // Build injury context string
    let injuryContext = "";
    if (injuries) {
      const formatInjuries = (team: string, list: any[]) => {
        if (!list || list.length === 0) return "";
        const out = list.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
        const dtd = list.filter((i: any) => i.status?.toLowerCase() === "day-to-day");
        let s = "";
        if (out.length > 0) {
          s += `${team} OUT/Doubtful (${out.length}): ${out.map((i: any) => `${i.name} (${i.position || "N/A"}, ${i.status})`).join(", ")}\n`;
        }
        if (dtd.length > 0) {
          s += `${team} Day-to-Day (${dtd.length}): ${dtd.map((i: any) => `${i.name} (${i.position || "N/A"})`).join(", ")}\n`;
        }
        return s;
      };

      if (injuries.team1) injuryContext += formatInjuries("Team 1", injuries.team1);
      if (injuries.team2) injuryContext += formatInjuries("Team 2", injuries.team2);
      if (Array.isArray(injuries) && injuries.length > 0) {
        injuryContext += `Injuries: ${injuries.map((i: any) => `${i.name} (${i.status})`).join(", ")}\n`;
      }
    }

    const injuryPromptSection = injuryContext
      ? `\n\nCURRENT INJURY REPORT (THIS IS THE MOST IMPORTANT FACTOR):\n${injuryContext}\n${getInjuryInstructions(sportLower)}`
      : "";

    // Build "without teammates" context
    let withoutTeammatesSection = "";
    if (withoutTeammatesData) {
      const wkp = withoutTeammatesData.withoutKeyPlayers;
      const wfr = withoutTeammatesData.withFullRoster;
      const labels = getWithoutTeammatesLabels(sportLower);
      if (wkp?.games > 0) {
        withoutTeammatesSection += `\n\nCROSS-REFERENCED HISTORICAL DATA (GAMES WITHOUT KEY TEAMMATES):`;
        withoutTeammatesSection += `\nWithout key teammates: ${wkp.avg} avg, ${wkp.hitRate}% hit rate over ${wkp.games} games`;
        withoutTeammatesSection += `\nWith full roster: ${wfr.avg} avg, ${wfr.hitRate}% hit rate over ${wfr.games} games`;
        if (wkp.per36 > 0) {
          withoutTeammatesSection += `\n${labels.perLabel}: ${wkp.per36} | ${labels.projLabel}: ${wkp.projectedMinutes}`;
        }
        for (const tb of withoutTeammatesData.teammateBreakdown || []) {
          if (tb.gamesWithout > 0) {
            withoutTeammatesSection += `\n  → Without ${tb.name} (${tb.position}): ${tb.avgWithout} avg vs ${tb.avgWith} with (${tb.gamesWithout} games sampled)`;
          }
        }
        withoutTeammatesSection += `\nIMPORTANT: Use these actual "games without teammates" numbers as your PRIMARY evidence for projecting tonight's performance. These are MORE predictive than season averages when key players are missing.`;
      }
    }

    const isUfc = sportLower === "ufc";
    const isNhl = sportLower === "nhl";

    const formatRule = `Write exactly 3 sections. Each MUST be 2-3 sentences and under 50 words. NO EXCEPTIONS.
Format each as: **Section Title**: plain text analysis.
Do NOT use markdown inside the text — no asterisks, no bold, no bullets. Only the title is wrapped in **.`;

    // Build pace context for moneyline prompts too
    const paceStr = buildPaceContextString(body.paceContext, sportLower);

    // ── NHL-specific moneyline/puckline/total prompt ──
    const nhlMoneylinePrompt = `You are a sharp NHL betting analyst. Be concise and data-driven. Use hockey terminology throughout.

Team/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors from our model:
- ${dataPoints || "No additional data"}${paceStr}${injuryPromptSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Your Verdict & Risk section must echo this exact recommendation — never contradict the top-level verdict. Support the model's pick decisively.

${formatRule}

1. Goaltending Edge — Starting goalie matchup, save %, GAA, recent form.
2. Special Teams & Matchup — PP/PK efficiency, pace, shot volume, fatigue, injuries.${paceStr ? " Reference game pace/total context." : ""}
3. Risk — Name ONE specific risk factor (goalie volatility, special-teams mismatch, back-to-back fatigue, key injury). Risk factors only. DO NOT recommend a unit size, mention "u" or "units", or repeat the verdict — sizing is shown separately in the Overall Verdict block.`;

    const ufcMoneylinePrompt = `You are a sharp MMA betting analyst. Be concise and data-driven. NEVER reference team sports concepts.

Fighter/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors:
- ${dataPoints || "No additional data"}

${formatRule}

1. Statistical Edge — Strike differential, accuracy, takedown defense, win probability.
2. Style Matchup — How styles interact, reach, finishing tendencies.
3. Risk — Name ONE specific risk factor (finish risk, cardio, reach disadvantage, weight cut concern). Risk factors only. DO NOT recommend a unit size, mention "u" or "units" — sizing is shown separately in the Overall Verdict block.`;

    const mlbMoneylinePrompt = `You are a sharp MLB betting analyst. Be concise and data-driven. Use baseball terminology throughout.

Team/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors from our model:
- ${dataPoints || "No additional data"}${paceStr}${injuryPromptSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Your Verdict & Risk section must echo this exact recommendation — never contradict the top-level verdict. Support the model's pick decisively.

${formatRule}

1. Pitching Matchup — Starting pitcher ERA, WHIP, K/9, recent form, pitch mix.
2. Lineup & Park Factor — Offensive splits, OPS, park dimensions, bullpen depth.${paceStr ? " Reference game total context." : ""}
3. Risk — Name ONE specific risk factor (bullpen volatility, weather, lineup uncertainty, opposing pitcher's ceiling). Risk factors only. DO NOT recommend a unit size, mention "u" or "units" — sizing is shown separately in the Overall Verdict block.`;

    const genericMoneylinePrompt = `You are a sharp sports betting analyst writing a moneyline/spread/total breakdown. Be specific, data-driven, and concise.

Team/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%
Sport: ${sport || "nba"}

Key factors from our model:
- ${dataPoints || "No additional data"}${paceStr}${injuryPromptSection}${withoutTeammatesSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Your Verdict & Risk section must echo this exact recommendation — never contradict the top-level verdict. Support the model's pick decisively.

${formatRule}

1. Statistical Edge — Why the model favors this side, win probability vs implied odds.${paceStr ? " Reference pace/total context." : ""}
2. Injury & Lineup Reality — Current injuries and what they mean for each team.
3. Risk — Name ONE specific risk factor (key injury, blowout risk, situational fade, opponent strength). Risk factors only. DO NOT recommend a unit size, mention "u" or "units" — sizing is shown separately in the Overall Verdict block.`;

    // Select the right prompt
    let prompt: string;
    if (type === "prop") {
      prompt = getPropPrompt(body, injuryPromptSection, withoutTeammatesSection);
    } else if (isUfc) {
      prompt = ufcMoneylinePrompt;
    } else if (isNhl) {
      prompt = nhlMoneylinePrompt;
    } else if (sportLower === "mlb") {
      prompt = mlbMoneylinePrompt;
    } else {
      prompt = genericMoneylinePrompt;
    }

    // Prepend the locked-pick block to every prompt (sport-agnostic, all bet types)
    prompt = lockedPickBlock + prompt;

    const systemMessage = getSystemMessage(sportLower, type) + "\n\n" + ANTI_GENERIC_INSTRUCTION;

    let content = "Analysis currently unavailable";
    try {
      const aiResult = await callAI({
        fnName: "ai-analysis",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: prompt },
        ],
        maxTokens: type === "prop" ? 1200 : 600,
        temperature: 0.3,
      });
      content = aiResult.output as string;
    } catch (e) {
      if (!(e instanceof AIProviderError)) console.error("AI API error:", e);
    }

    // ── Hard scrub: never leak internal model labels or robotic "0 units on X" copy ──
    const passLabel = decision && decision.winning_team_name && team1Name && team2Name
      ? `pass on ${team1Name} vs ${team2Name}`
      : "pass on this line";
    content = content
      .replace(/\bnoBet tier\b/gi, "below our confidence threshold")
      .replace(/\bnoBet\b/gi, "pass")
      .replace(/\b0\s*units?\s+on\s+[A-Za-z .'-]+/gi, passLabel)
      .replace(/\bstick with 0 units\b/gi, passLabel);

    // Strip any unit-sizing language that slipped through despite the prompt
    // (Risk should never mention sizing — that's the Overall Verdict block).
    // Also strip any raw prop codes (NHL_SOG, NBA_THREES, MLB_RBI, etc.).
    content = stripPropCodes(
      content
        .replace(UNIT_SIZING_RE, "")
        .replace(TRAILING_UNITS_RE, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.!?])/g, "$1")
        .trim()
    );

    // Parse sections using multi-format parser
    const maxSections = type === "prop" ? 5 : 3;
    const sections = parseSections(content).slice(0, maxSections);

    // Fallback if parsing still fails
    if (sections.length === 0) {
      const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
      for (const line of lines.slice(0, maxSections)) {
        sections.push({ title: "", content: truncateSection(line.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "").trim()) });
      }
    }

    return new Response(JSON.stringify({ sections: sections.slice(0, maxSections) }), {
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
