import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

/* ── Sport-specific prop prompts ── */
function getPropPrompt(body: any, injurySection: string, teammatesSection: string): string {
  const { playerOrTeam, propDisplay, overUnder, line, verdict, confidence, sport } = body;
  const dataPoints = (body.reasoning || body.factors || []).join("\n- ");
  const s = (sport || "").toLowerCase();

  if (s === "mlb") return `You are a sharp MLB betting analyst. Be concise and data-driven. Use baseball terminology throughout.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Data points:
- ${dataPoints || "No additional data"}${injurySection}${teammatesSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}" (confidence: ${confidence}%).
If the verdict is "DO NOT BET" or "RISKY", do NOT recommend betting. If it's "STRONG PICK", be assertive.
Support the model — do NOT contradict it.

Write exactly 3 sections. Each: bold title + 2-3 sentences max.
1. **Statistical Edge** — Season stats, L10 trends, platoon splits, K rate / ERA / WHIP / OPS supporting the bet.
2. **Matchup & Park Factor** — Opposing pitcher or hitter matchup, park dimensions, weather, bullpen state, lineup protection.
3. **Verdict & Risk** — Final recommendation with unit sizing and key risk (e.g., short outing, weather delay, cold bat).

Format: **Title**: Analysis text. No bullets. Be assertive.`;

  if (s === "nhl") return `You are a sharp NHL betting analyst. Be concise and data-driven. Use hockey terminology throughout.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Data points:
- ${dataPoints || "No additional data"}${injurySection}${teammatesSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}" (confidence: ${confidence}%).
If the verdict is "DO NOT BET" or "RISKY", do NOT recommend betting. If it's "STRONG PICK", be assertive.
Support the model — do NOT contradict it.

Write exactly 3 sections. Each: bold title + 2-3 sentences max.
1. **Statistical Edge** — SOG trends, shooting %, ice time, power-play involvement supporting the bet.
2. **Matchup & Lineup** — Opposing goalie save %, line combinations, PP/PK time, back-to-back fatigue.
3. **Verdict & Risk** — Final recommendation with unit sizing and key risk (e.g., goalie change, reduced TOI, cold streak).

Format: **Title**: Analysis text. No bullets. Be assertive.`;

  // NBA / default
  return `You are a sharp sports betting analyst. Be concise, data-driven, and persuasive.

Player: ${playerOrTeam}
Prop: ${propDisplay || "N/A"} ${overUnder || "OVER"} ${line || "N/A"}
Verdict: ${verdict}
Model Confidence: ${confidence}%
Sport: ${sport || "nba"}

Data points:
- ${dataPoints || "No additional data"}${injurySection}${teammatesSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}" (confidence: ${confidence}%).
If the verdict is "DO NOT BET" or "RISKY", do NOT recommend betting. If it's "STRONG PICK", be assertive.
Support the model — do NOT contradict it.

Write exactly 3 sections. Each: bold title + 2 sentences max.
1. **Statistical Edge** — Hit rates, averages, trends supporting the bet.
2. **Matchup & Injuries** — Opponent matchup, pace, injuries affecting this prop.
3. **Verdict & Risk** — Final recommendation with unit sizing and key risk.

Format: **Title**: Analysis text. No bullets. Be assertive.`;
}

/* ── Sport-specific system messages ── */
function getSystemMessage(sport: string, type: string): string {
  const s = (sport || "").toLowerCase();
  if (s === "ufc") return "You are an expert MMA betting analyst. Write concise analytical fight breakdowns in 3 short sections. Never hedge — take a clear stance. Use specific numbers.";
  if (s === "nhl") return "You are an expert NHL betting analyst. Write concise analytical breakdowns in 3 short sections. Never hedge — take a clear stance. Use hockey terminology: save percentage, GAA, puck line, power play, penalty kill, shots on goal, Corsi, TOI, etc.";
  if (s === "mlb") return "You are an expert MLB betting analyst. Write concise analytical breakdowns in 3 short sections. Never hedge — take a clear stance. Use baseball terminology: ERA, WHIP, K/9, OPS, wOBA, park factor, bullpen, lineup protection, platoon splits, pitch mix, launch angle, etc.";
  if (type === "prop") return "You are an expert sports betting analyst. Write concise analytical breakdowns in 3 short sections. Never hedge — take a clear stance. Current injuries matter MORE than historical data.";
  return "You are an expert sports betting analyst. Write concise analytical breakdowns in 3 short sections. Never hedge — take a clear stance. Current injuries matter MORE than historical data.";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type, verdict, confidence, playerOrTeam, line, propDisplay, overUnder, reasoning, factors, injuries, sport, withoutTeammatesData } = body;

    const dataPoints = (reasoning || factors || []).join("\n- ");
    const sportLower = (sport || "nba").toLowerCase();

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

    // ── NHL-specific moneyline/puckline/total prompt ──
    const nhlMoneylinePrompt = `You are a sharp NHL betting analyst. Be concise and data-driven. Use hockey terminology throughout.

Team/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors from our model:
- ${dataPoints || "No additional data"}${injuryPromptSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Support the model's pick — do NOT contradict it.

Write exactly 3 sections. Each: bold title + 2-3 sentences max.
1. **Goaltending Edge** — Starting goalie matchup, save percentages, GAA, recent form (L5 starts). Which netminder has the advantage and why.
2. **Special Teams & Matchup** — Power play vs penalty kill efficiency, pace of play, shot volume, back-to-back fatigue, home ice advantage, and any key injuries to skaters.
3. **Verdict & Puck Line Value** — Final recommendation with unit sizing. Address puck line value if relevant. Flag only meaningful risks (back-to-back, goalie injury, cold streak).

FORMATTING RULES: Write in normal sentence case. Do NOT use ALL CAPS except for the verdict label. Do not number sections with "1.", "2.", "3." — just use the bold title format.
Format: **Title**: Analysis text. No bullets. Be assertive and decisive.`;

    const ufcMoneylinePrompt = `You are a sharp MMA betting analyst. Be concise and data-driven. NEVER reference team sports concepts.

Fighter/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors:
- ${dataPoints || "No additional data"}

Write exactly 3 sections. Each: bold title + 2 sentences max.
1. **Statistical Edge** — Strike differential, accuracy, takedown defense, win probability vs implied odds.
2. **Style Matchup** — How styles interact. Striker vs grappler dynamics, reach, finishing tendencies.
3. **Verdict & Risk** — Final recommendation with unit sizing. Flag only meaningful risks (age 37+, layoff, weight cut).

Format: **Title**: Analysis text. No bullets. Be assertive.`;

    const mlbMoneylinePrompt = `You are a sharp MLB betting analyst. Be concise and data-driven. Use baseball terminology throughout.

Team/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%

Key factors from our model:
- ${dataPoints || "No additional data"}${injuryPromptSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Support the model's pick — do NOT contradict it.

Write exactly 3 sections. Each: bold title + 2-3 sentences max.
1. **Pitching Matchup** — Starting pitcher ERA, WHIP, K/9, recent form (L3-5 starts), pitch mix, L/R splits. Which starter has the edge.
2. **Lineup & Park Factor** — Offensive splits, OPS, wOBA, park dimensions, weather, bullpen depth, and key injuries affecting run production.
3. **Verdict & Run Line Value** — Final recommendation with unit sizing. Address run line value if relevant. Flag key risks (bullpen fatigue, weather, travel).

FORMATTING RULES: Write in normal sentence case. Do NOT use ALL CAPS except for the verdict label. Do not number sections with "1.", "2.", "3." — just use the bold title format.
Format: **Title**: Analysis text. No bullets. Be assertive and decisive.`;

    const genericMoneylinePrompt = `You are a sharp sports betting analyst writing a moneyline/spread/total breakdown. Be specific, data-driven, and concise.

Team/Pick: ${playerOrTeam}
Verdict: ${verdict}
Model Confidence: ${confidence}%
Sport: ${sport || "nba"}

Key factors from our model:
- ${dataPoints || "No additional data"}${injuryPromptSection}${withoutTeammatesSection}

CRITICAL: Your final verdict MUST ALIGN with "${verdict}". Support the model's pick — do NOT contradict it.

Write exactly 3 analysis sections. Each section: bold title + 2 sentences max. Cover:
1. **Statistical Edge** — Why the model favors this side. Win probability vs implied odds.
2. **Injury & Lineup Reality** — Current injuries, what they mean for each team. If a team is severely depleted, say so clearly.
3. **Verdict & Risk** — Final recommendation with unit sizing. Match "${verdict}".

FORMATTING RULES: Write in normal sentence case. Do NOT use ALL CAPS except for the verdict label. Do not number sections with "1.", "2.", "3." — just use the bold title format.
Format: **Title**: Analysis text. No bullet points. Be assertive and decisive.`;

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.7,
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

    // ── Improved section parser: split on bold headers ──
    const sections: { title: string; content: string }[] = [];
    
    const parts = content.split(/\*\*/).filter((s: string) => s.trim().length > 0);
    for (let i = 0; i < parts.length; i += 2) {
      const title = parts[i]?.trim().replace(/^\d+\.\s*/, "").replace(/[:\s]+$/, "");
      const body = parts[i + 1]?.trim().replace(/^[:\s]+/, "") || "";
      if (title && body) {
        sections.push({ title, content: body });
      }
    }

    // Fallback if parsing fails
    if (sections.length === 0) {
      const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
      for (const line of lines.slice(0, 5)) {
        sections.push({ title: "", content: line.trim() });
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
