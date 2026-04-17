import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── Truncate a section to ~50 words ── */
function truncateSection(text: string, maxChars = 280): string {
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

/* ── Sport-specific prop prompts ── */
function getPropPrompt(body: any, injurySection: string, teammatesSection: string): string {
  const { playerOrTeam, propDisplay, overUnder, line, verdict, confidence, sport } = body;
  const dataPoints = (body.reasoning || body.factors || []).join("\n- ");
  const s = (sport || "").toLowerCase();

  const formatRule = `Write exactly 3 sections. Each MUST be 2-3 sentences and under 50 words. NO EXCEPTIONS — output is auto-truncated.
Format each as: **Section Title**: plain text analysis.
Do NOT use markdown inside the text — no asterisks, no bold, no bullets. Only the title is wrapped in **.`;

  const overallRating = body.overallRating || "";
  const ratingInstruction = overallRating === "fade"
    ? `The overall verdict is FADE. Do NOT recommend betting. Acknowledge the risks clearly. Your Verdict & Risk MUST say to pass or avoid.`
    : overallRating === "lean"
      ? `The overall verdict is LEAN. Be cautiously optimistic. Mention it's a small-unit play with caveats.`
      : overallRating === "take"
        ? `The overall verdict is TAKE. Be assertive and confident. Recommend the bet clearly.`
        : `Your final verdict MUST ALIGN with "${verdict}".`;

  // Build pace context string
  const paceStr = buildPaceContextString(body.paceContext, s);

  if (s === "mlb") return `You are a sharp MLB betting analyst. Be concise and data-driven. Use baseball terminology throughout.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Data points:
- ${dataPoints || "No additional data"}${paceStr}${injurySection}${teammatesSection}

CRITICAL: ${ratingInstruction} The direction is ${overUnder || "OVER"} ${line || "N/A"}. Never contradict the overall rating.

${formatRule}

1. Statistical Edge — Season stats, L10 trends, platoon splits, K rate / ERA / WHIP / OPS.
2. Matchup & Park Factor — Opposing pitcher/hitter matchup, park dimensions, weather, bullpen state.${paceStr ? " Factor in game pace/total context." : ""}
3. Verdict & Risk — Final recommendation with unit sizing and key risk.`;

  if (s === "nhl") return `You are a sharp NHL betting analyst. Be concise and data-driven. Use hockey terminology throughout.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Data points:
- ${dataPoints || "No additional data"}${paceStr}${injurySection}${teammatesSection}

CRITICAL: ${ratingInstruction} The direction is ${overUnder || "OVER"} ${line || "N/A"}. Never contradict the overall rating.

${formatRule}

1. Statistical Edge — SOG trends, shooting %, ice time, power-play involvement.
2. Matchup & Lineup — Opposing goalie save %, line combinations, PP/PK time, fatigue.${paceStr ? " Factor in game pace/total context." : ""}
3. Verdict & Risk — Final recommendation with unit sizing and key risk.`;

  // NBA / default
  return `You are a sharp sports betting analyst. Be concise, data-driven, and persuasive.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%
Sport: ${sport || "nba"}

Data points:
- ${dataPoints || "No additional data"}${paceStr}${injurySection}${teammatesSection}

CRITICAL: ${ratingInstruction} The direction is ${overUnder || "OVER"} ${line || "N/A"}. Never contradict the overall rating.

${formatRule}

1. Statistical Edge — Hit rates, averages, trends supporting the bet.
2. Matchup & Pace — Opponent matchup, pace of play, injuries affecting this prop.${paceStr ? " Use the game pace/total context provided." : ""}
3. Verdict & Risk — Final recommendation with unit sizing and key risk.`;
}

/* ── Sport-specific system messages ── */
function getSystemMessage(sport: string, type: string): string {
  const base = "STRICT RULES: Each section MUST be 2-3 sentences and under 50 words. No exceptions. No paragraphs. No markdown inside text. Only use **Title**: format for section headers. Output that exceeds 50 words per section will be auto-truncated.";
  const s = (sport || "").toLowerCase();
  if (s === "ufc") return `You are an expert MMA betting analyst. Be concise. Never hedge — take a clear stance. Use specific numbers. ${base}`;
  if (s === "nhl") return `You are an expert NHL betting analyst. Be concise. Never hedge — take a clear stance. Use hockey terminology: save %, GAA, puck line, PP, PK, SOG, Corsi, TOI. ${base}`;
  if (s === "mlb") return `You are an expert MLB betting analyst. Be concise. Never hedge — take a clear stance. Use baseball terminology: ERA, WHIP, K/9, OPS, wOBA, park factor. ${base}`;
  if (type === "prop") return `You are an expert sports betting analyst. Be concise. Never hedge — take a clear stance. Current injuries matter MORE than historical data. ${base}`;
  return `You are an expert sports betting analyst. Be concise. Never hedge — take a clear stance. Current injuries matter MORE than historical data. ${base}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type, verdict, confidence, playerOrTeam, line, propDisplay, overUnder, reasoning, factors, injuries, sport, withoutTeammatesData, overallRating, overallSummary: overallSummaryText, decision } = body;

    const dataPoints = (reasoning || factors || []).join("\n- ");
    const sportLower = (sport || "nba").toLowerCase();

    // ── LOCKED PICK BLOCK — sport-agnostic, prepended to every prompt ──
    const lockedPickBlock = decision && decision.winning_team_name
      ? `\n\nLOCKED PICK (DO NOT CONTRADICT — THIS IS THE FINAL DECISION):
- Side: ${decision.winning_team_name}
- Conviction tier: ${decision.conviction_tier}
- Recommended sizing: ${decision.recommended_units} units
- Win probability: ${decision.win_probability}%
- Edge over market: ${decision.edge ?? "n/a"}%

ABSOLUTE RULES:
1. You MUST write rationale supporting THIS pick. Do NOT recommend the opposite side.
2. Do NOT change the unit size. Use exactly ${decision.recommended_units} units.
3. Your final "Verdict & Risk" section MUST explicitly say: "${decision.recommended_units} units on ${decision.winning_team_name}".
4. If conviction is "noBet" or units = 0, recommend PASSING — do not push a side.
5. Never reference the losing side as the recommended play.\n`
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
3. Verdict & Puck Line Value — Final recommendation with unit sizing and key risk.`;

    const ufcMoneylinePrompt = `You are a sharp MMA betting analyst. Be concise and data-driven. NEVER reference team sports concepts.

Fighter/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors:
- ${dataPoints || "No additional data"}

${formatRule}

1. Statistical Edge — Strike differential, accuracy, takedown defense, win probability.
2. Style Matchup — How styles interact, reach, finishing tendencies.
3. Verdict & Risk — Final recommendation with unit sizing and key risk.`;

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
3. Verdict & Run Line Value — Final recommendation with unit sizing and key risk.`;

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
3. Verdict & Risk — Final recommendation with unit sizing. Match "${verdict}".`;

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

    const systemMessage = getSystemMessage(sportLower, type);

    // Determine AI provider: prefer Grok (xAI) if key is set, fallback to Lovable AI Gateway
    const XAI_API_KEY = Deno.env.get("XAI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    let aiEndpoint: string;
    let aiKey: string;
    let aiModel: string;
    
    if (XAI_API_KEY) {
      aiEndpoint = "https://api.x.ai/v1/chat/completions";
      aiKey = XAI_API_KEY;
      aiModel = "grok-3";
      console.log("Using Grok (xAI) for analysis");
    } else if (LOVABLE_API_KEY) {
      aiEndpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
      aiKey = LOVABLE_API_KEY;
      aiModel = "google/gemini-2.5-flash";
      console.log("Using Lovable AI Gateway for analysis");
    } else {
      throw new Error("No AI API key configured (XAI_API_KEY or LOVABLE_API_KEY)");
    }

    const aiResponse = await fetch(aiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${aiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: prompt },
        ],
        max_tokens: 600,
        temperature: 0.6,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI API error:", errText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse sections using multi-format parser
    const sections = parseSections(content).slice(0, 3);

    // Fallback if parsing still fails
    if (sections.length === 0) {
      const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
      for (const line of lines.slice(0, 3)) {
        sections.push({ title: "", content: truncateSection(line.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "").trim()) });
      }
    }

    return new Response(JSON.stringify({ sections: sections.slice(0, 3) }), {
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
