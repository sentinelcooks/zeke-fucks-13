import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Brain, TrendingUp, Swords, BarChart3, AlertTriangle, Loader2, ChevronDown, ChevronUp, CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface Decision {
  winning_side: "team1" | "team2" | "over" | "under" | null;
  winning_team_name: string | null;
  win_probability: number;
  edge: number | null;
  conviction_tier: "noBet" | "low" | "medium" | "high" | "veryHigh";
  recommended_units: 0 | 0.5 | 1 | 2 | 3;
  verdict_text: string;
  grade_explanation?: string;
}

interface WrittenAnalysisProps {
  verdict: string;
  confidence: number;
  playerOrTeam: string;
  line?: number;
  propDisplay?: string;
  overUnder?: string;
  reasoning?: string[];
  factors?: string[];
  type: "prop" | "moneyline";
  // New: pass full results for overall summary
  seasonHitRate?: { rate?: number; hits?: number; total?: number; avg?: number };
  last10?: { rate?: number; avg?: number };
  last5?: { rate?: number; avg?: number };
  h2hAvg?: number;
  ev?: number;
  edge?: number;
  minutesTrend?: string;
  injuries?: any[];
  sport?: string;
  withoutTeammatesData?: any;
  paceContext?: any;
  factorBreakdown?: Array<{ name: string; team1Score?: number; team2Score?: number; weight?: number }>;
  // Single source of truth from backend (moneyline-api). When present, overrides local recompute.
  decision?: Decision | null;
  // Names of the two teams — used for the validation guardrail
  team1Name?: string;
  team2Name?: string;
}

interface AnalysisSection {
  title: string;
  content: string;
}

const SECTION_ICONS = [
  <BarChart3 className="w-3.5 h-3.5" />,
  <Swords className="w-3.5 h-3.5" />,
  <TrendingUp className="w-3.5 h-3.5" />,
  <Brain className="w-3.5 h-3.5" />,
  <AlertTriangle className="w-3.5 h-3.5" />,
];

const SECTION_COLORS = [
  "text-nba-blue",
  "text-nba-green",
  "text-accent",
  "text-nba-yellow",
  "text-nba-red",
];

function generateFallbackSections(data: WrittenAnalysisProps): AnalysisSection[] {
  const { verdict, confidence, playerOrTeam, line, propDisplay, overUnder, reasoning = [], factors = [] } = data;
  const ev = (data as any).ev;
  const edge = (data as any).edge;
  const source = reasoning.length > 0 ? reasoning : factors;
  const direction = overUnder?.toUpperCase() || "OVER";
  const lineProp = line ? `${direction} ${line}${propDisplay ? ` ${propDisplay}` : ""}` : direction;
  const evStr = typeof ev === "number" && ev !== 0 ? ` · +${ev.toFixed(1)}% EV` : "";
  const edgeStr = typeof edge === "number" && edge !== 0 ? ` · ${edge > 0 ? "+" : ""}${edge.toFixed(1)}% edge` : "";
  const sizingStr = confidence >= 65 ? "1.5–2 units" : confidence >= 55 ? "1 unit" : "0.5 units";

  const sections: AnalysisSection[] = [];

  if (data.type === "prop") {
    sections.push({
      title: "Statistical Edge",
      content: source[0] || (confidence >= 70
        ? `${playerOrTeam} hits ${lineProp} at ${confidence}% model confidence${edgeStr}${evStr}. Recent volume and usage rate trend above this threshold.`
        : `${playerOrTeam} projects ${lineProp} at ${confidence}% confidence${edgeStr}${evStr}. Model identifies a moderate edge — proceed with reduced sizing.`),
    });
    sections.push({
      title: "Matchup Breakdown",
      content: source[1] || `Opponent defensive profile and game pace both factor into this ${direction} lean for ${playerOrTeam} at ${line ?? "this"} ${propDisplay || "line"}.`,
    });
    sections.push({
      title: "Recent Form",
      content: source[2] || `Game log trend supports the ${direction} at ${line ?? "this number"} — monitor pregame news for injury or lineup changes before betting.`,
    });
    sections.push({
      title: "Line Value",
      content: source[3] || `The ${lineProp} line offers ${edge != null && edge > 3 ? "clear" : "marginal"} market value${evStr}. Stale line or sharp action may tighten before tip.`,
    });
    sections.push({
      title: "Risk & Verdict",
      content: verdict === "STRONG PICK"
        ? `${playerOrTeam} ${lineProp} — ${confidence}% confidence${edgeStr}. High-conviction play, sized at ${sizingStr}. Primary risk: early blowout or unexpected DNP.`
        : `${playerOrTeam} ${lineProp} — ${confidence}% confidence${edgeStr}. Lean play, sized at ${sizingStr}. ${source[4] || "Monitor lineup status. Standard bankroll management applies."}`,
    });
  } else {
    sections.push({
      title: "Statistical Edge",
      content: source[0] || `${playerOrTeam} grades at ${confidence}% win probability${edgeStr}${evStr}. ${confidence >= 60 ? "Meaningful edge over the implied market price." : "Slight edge — reduce sizing accordingly."}`,
    });
    factors.slice(0, 4).forEach((f, i) => {
      sections.push({
        title: ["Matchup Analysis", "Situational Factors", "Market Assessment", "Risk & Verdict"][i] || `Factor ${i + 2}`,
        content: f,
      });
    });
    while (sections.length < 5) {
      sections.push({
        title: "Additional Context",
        content: `${confidence}% model confidence${edgeStr}. Proceed at ${sizingStr} with standard bankroll management.`,
      });
    }
  }

  return sections.slice(0, 5);
}

type Tier = "noBet" | "low" | "medium" | "high" | "veryHigh";

function unitsToLabel(u: number): string {
  if (u <= 0) return "0 units";
  if (u === 0.5) return "0.5 units";
  if (u === 1) return "1 unit";
  return `${u} units`;
}

function tierToSizing(tier: Tier, exactUnits?: number): { rating: "take" | "lean" | "fade"; unitSize: string | null } {
  // When backend supplies exact units, use them as the single source of truth
  if (exactUnits != null && exactUnits > 0) {
    const rating = exactUnits >= 2 ? "take" : "lean";
    return { rating, unitSize: unitsToLabel(exactUnits) };
  }
  switch (tier) {
    case "veryHigh": return { rating: "take", unitSize: "3 units" };
    case "high": return { rating: "take", unitSize: "2 units" };
    case "medium": return { rating: "lean", unitSize: "1 unit" };
    case "low": return { rating: "lean", unitSize: "0.5 units" };
    case "noBet": default: return { rating: "fade", unitSize: null };
  }
}

function computeMoneylineTier(props: WrittenAnalysisProps): { tier: Tier; favorTeam1: number; favorTeam2: number; neutral: number; winnerSide: 1 | 2 | null } {
  const v = (props.verdict || "").toUpperCase();
  const fb = Array.isArray(props.factorBreakdown) ? props.factorBreakdown : [];
  let favorTeam1 = 0, favorTeam2 = 0, neutral = 0;
  for (const f of fb) {
    if ((f.weight ?? 1) <= 0) continue;
    const t1 = Number(f.team1Score ?? 0);
    const t2 = Number(f.team2Score ?? 0);
    if (t1 >= 60 && t1 > t2) favorTeam1++;
    else if (t2 >= 60 && t2 > t1) favorTeam2++;
    else neutral++;
  }
  const winnerCount = Math.max(favorTeam1, favorTeam2);
  const total = favorTeam1 + favorTeam2;
  const dominanceRatio = total > 0 ? winnerCount / total : 0;
  const winnerSide: 1 | 2 | null = favorTeam1 > favorTeam2 ? 1 : favorTeam2 > favorTeam1 ? 2 : null;

  // Hard guard: toss-up or no clear direction → no bet
  const hasDirection = v.includes("LEAN") || v.includes("STRONG");
  if (v === "TOSS-UP" || !hasDirection) return { tier: "noBet", favorTeam1, favorTeam2, neutral, winnerSide };

  let tier: Tier;
  if (winnerCount < 3 || dominanceRatio < 0.55) tier = "noBet";
  else if (dominanceRatio < 0.65) tier = "low";
  else if (dominanceRatio < 0.75) tier = "medium";
  else if (dominanceRatio < 0.90) tier = "high";
  else tier = "veryHigh";

  return { tier, favorTeam1, favorTeam2, neutral, winnerSide };
}

function generateOverallSummary(props: WrittenAnalysisProps): { rating: "take" | "lean" | "fade"; summary: string; unitSize: string | null } {
  const { confidence, playerOrTeam, line, propDisplay, overUnder, seasonHitRate, last10, last5, h2hAvg, ev, edge, minutesTrend, injuries, sport, type, verdict, decision } = props;
  const direction = overUnder?.toUpperCase() || "OVER";
  const pickLabel = line != null ? `${playerOrTeam} ${direction} ${line} ${propDisplay || ""}`.trim() : playerOrTeam;

  // ── SINGLE SOURCE OF TRUTH: if backend provided a decision, honor it. Never recompute. ──
  if (decision && decision.winning_team_name && type === "moneyline") {
    const tier = decision.conviction_tier;
    const { rating, unitSize } = tierToSizing(tier, decision.recommended_units);
    const winner = decision.winning_team_name;
    const t1 = props.team1Name || "Team 1";
    const t2 = props.team2Name || "Team 2";
    const matchup = `${t1} vs ${t2}`;

    if (tier === "noBet") {
      const reason = (() => {
        const r = (decision as any).pass_reason;
        if (r === "toss_up") return `${matchup} grades as a toss-up — no meaningful edge for either side.`;
        if (r === "negative_edge") return `Market price on ${winner} already implies more than our model gives (${decision.win_probability}% vs implied${decision.edge != null ? `, ${decision.edge}% edge` : ""}).`;
        return `${matchup} doesn't clear our confidence threshold for a sized play (model: ${decision.win_probability}% on ${winner}).`;
      })();
      return { rating, summary: `Passing on ${matchup}. ${reason}`, unitSize: null };
    }

    let intro: string;
    if (tier === "veryHigh") intro = `Very high conviction on ${winner}. Model gives a ${decision.win_probability}% win probability${decision.edge != null ? ` with a ${decision.edge}% edge over the market` : ""}.`;
    else if (tier === "high") intro = `Strong play on ${winner}. ${decision.win_probability}% win probability${decision.edge != null ? `, ${decision.edge}% edge` : ""}.`;
    else if (tier === "medium") intro = `Solid lean on ${winner} at ${decision.win_probability}% win probability${decision.edge != null ? ` (${decision.edge}% edge)` : ""}.`;
    else intro = `Slight lean on ${winner}. ${decision.win_probability}% win probability${decision.edge != null ? `, ${decision.edge}% edge` : ""}.`;

    return { rating, summary: `${intro} Recommended sizing: ${unitSize}.`, unitSize };
  }

  if (type === "moneyline") {
    const { tier, favorTeam1, favorTeam2, neutral } = computeMoneylineTier(props);
    const { rating, unitSize } = tierToSizing(tier);

    if (tier === "noBet") {
      const matchup = props.team1Name && props.team2Name ? `${props.team1Name} vs ${props.team2Name}` : pickLabel;
      const summary = `Passing on ${matchup}. Factors split too evenly (${favorTeam1} vs ${favorTeam2}, ${neutral} neutral) to bet with conviction.`;
      return { rating, summary, unitSize: null };
    }

    let intro: string;
    if (tier === "veryHigh") intro = `Very high conviction. Nearly all factors favor ${pickLabel}.`;
    else if (tier === "high") intro = `Strong play. ${pickLabel} has a clear majority of factors in its favor.`;
    else if (tier === "medium") intro = `Solid lean. ${pickLabel} has a moderate edge across factors.`;
    else intro = `Slight lean. ${pickLabel} has a small edge in the factor count.`;

    return { rating, summary: `${intro} Recommended sizing: ${unitSize}.`, unitSize };
  }

  // Props: use model verdict as primary override, multi-signal scoring as tiebreaker
  const v = (verdict || "").toUpperCase();
  const signals: string[] = [];
  let bullish = 0;
  let bearish = 0;

  if (seasonHitRate?.rate) {
    if (seasonHitRate.rate >= 65) { bullish++; signals.push(`Season hit rate at ${seasonHitRate.rate}% (${seasonHitRate.hits}/${seasonHitRate.total})`); }
    else if (seasonHitRate.rate < 45) { bearish++; signals.push(`Season hit rate only ${seasonHitRate.rate}%`); }
    else { signals.push(`Season hit rate at ${seasonHitRate.rate}%`); }
  }
  if (last10?.rate) {
    if (last10.rate >= 70) { bullish++; signals.push(`L10 trending strong at ${last10.rate}%`); }
    else if (last10.rate < 40) { bearish++; signals.push(`L10 cold at only ${last10.rate}%`); }
  }
  if (last5?.rate) {
    if (last5.rate >= 80) { bullish++; signals.push(`L5 red hot at ${last5.rate}%`); }
    else if (last5.rate < 40) { bearish++; signals.push(`L5 struggling at ${last5.rate}%`); }
  }
  if (h2hAvg && line) {
    if (h2hAvg > line) { bullish++; signals.push(`H2H avg (${h2hAvg}) clears the line`); }
    else { bearish++; signals.push(`H2H avg (${h2hAvg}) below the line`); }
  }
  if (ev && ev > 0) { bullish++; signals.push(`+EV at ${ev.toFixed(1)}%`); }
  else if (ev && ev < -5) { bearish++; signals.push(`Negative EV at ${ev.toFixed(1)}%`); }
  if (edge && edge > 3) bullish++;
  const trendLabel = sport === "nhl" ? "TOI" : "Minutes";
  if (minutesTrend === "down") { bearish++; signals.push(`${trendLabel} trending down`); }
  else if (minutesTrend === "up") { bullish++; signals.push(`${trendLabel} trending up`); }
  const injuredOut = (Array.isArray(injuries) ? injuries : []).filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  if (injuredOut.length >= 3 && direction === "OVER") {
    bullish += 2;
    signals.push(`🧠 Discretion: ${injuredOut.length} key teammates OUT — historical stats are unreliable, expanded role favors over`);
  } else if (injuredOut.length >= 2 && direction === "OVER") {
    bullish++;
    signals.push(`Key teammates out — usage boost expected`);
  } else if (injuredOut.length >= 3 && direction === "UNDER") {
    bearish += 2;
    signals.push(`⚠️ ${injuredOut.length} teammates OUT — under is dangerous with expanded role`);
  } else if (injuries && injuries.length > 0) {
    signals.push("Injury concerns — monitor pregame");
  }

  if (confidence >= 70) bullish += 2;
  else if (confidence >= 55) bullish++;
  else if (confidence < 40) bearish += 2;

  const score = bullish - bearish;
  const decisive = bullish + bearish;
  const dominanceRatio = decisive > 0 ? Math.max(bullish, bearish) / decisive : 0;

  let tier: Tier;
  // Hard guard: explicit DO NOT BET / RISKY-low / very low confidence
  if (v === "DO NOT BET" || (v === "RISKY" && confidence < 50) || confidence < 45) {
    tier = "noBet";
  } else if (bullish < 3 || score <= 0 || dominanceRatio < 0.55) {
    tier = "noBet";
  } else if ((v.includes("STRONG")) && confidence >= 65 && dominanceRatio >= 0.75) {
    tier = dominanceRatio >= 0.90 ? "veryHigh" : "high";
  } else if (dominanceRatio >= 0.90 && confidence >= 65) {
    tier = "veryHigh";
  } else if (dominanceRatio >= 0.75 && confidence >= 60) {
    tier = "high";
  } else if (dominanceRatio >= 0.65) {
    tier = "medium";
  } else {
    tier = "low";
  }

  const { rating, unitSize } = tierToSizing(tier);
  const signalText = signals.length > 0 ? " " + signals.slice(0, 4).join(". ") + "." : "";

  if (tier === "noBet") {
    return { rating, summary: `Passing on ${pickLabel}. The data doesn't strongly support this play.${signalText}`, unitSize: null };
  }

  let summaryIntro: string;
  if (tier === "veryHigh") summaryIntro = `Very high conviction. Nearly all signals favor ${pickLabel}.`;
  else if (tier === "high") summaryIntro = `Strong play. ${pickLabel} checks the boxes.`;
  else if (tier === "medium") summaryIntro = `Solid lean. ${pickLabel} has a moderate edge.`;
  else summaryIntro = `Slight lean. ${pickLabel} has a small edge.`;

  return { rating, summary: `${summaryIntro}${signalText} Recommended sizing: ${unitSize}.`, unitSize };
}

const FORBIDDEN_WHEN_SIZED = /(toss-?up|coin-?flip|\bpass\b|uncertainty)/i;

const WrittenAnalysis = (props: WrittenAnalysisProps) => {
  const rawSummary = generateOverallSummary(props);
  // Belt-and-suspenders scrub: if forbidden language appears in the summary text,
  // force noBet so we never show a sizing line alongside "toss-up/coin-flip/pass/uncertainty".
  const overallSummary = (() => {
    if (rawSummary.unitSize && FORBIDDEN_WHEN_SIZED.test(rawSummary.summary)) {
      const scrubbed = rawSummary.summary
        .replace(/\s*Recommended sizing:[^.]*\.?/i, "")
        .trim();
      return { rating: "fade" as const, unitSize: null as string | null, summary: `${scrubbed} No bet recommended.`.trim() };
    }
    return rawSummary;
  })();
  const isNoBet = overallSummary.unitSize === null;
  const [sections, setSections] = useState<AnalysisSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  // Sport-agnostic decision validator. Returns the offending section name if a contradiction is found.
  const validateAgainstDecision = (sects: AnalysisSection[]): string | null => {
    const decision = props.decision;
    if (!decision || !decision.winning_team_name) return null;
    if (props.type !== "moneyline") return null;

    const winnerName = decision.winning_team_name.toLowerCase();
    const loserName = (() => {
      if (decision.winning_side === "team1") return (props.team2Name || "").toLowerCase();
      if (decision.winning_side === "team2") return (props.team1Name || "").toLowerCase();
      if (decision.winning_side === "over") return "under";
      if (decision.winning_side === "under") return "over";
      return "";
    })();
    if (!loserName || loserName === winnerName) return null;

    // Match phrases like "bet on X", "take X", "lean X", "X moneyline", "X to cover", "I like X", "back X"
    const escaped = loserName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\b(bet on|take|lean(?:ing)? toward|back|i like|i'd take|recommend|pick)\\s+(?:the\\s+)?${escaped}\\b|\\b${escaped}\\s+(moneyline|to cover|to win|are the play|is the play)\\b`,
      "i"
    );

    for (const s of sects) {
      if (re.test(s.content || "") || re.test(s.title || "")) {
        return s.title || "section";
      }
    }
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_RETRIES = 2;

    const fetchAnalysis = async (): Promise<void> => {
      if (attempts === 0) setLoading(true);
      else setRegenerating(true);
      try {
        const { data, error } = await supabase.functions.invoke("ai-analysis", {
          body: {
            type: props.type,
            verdict: props.verdict,
            confidence: props.confidence,
            playerOrTeam: props.playerOrTeam,
            line: props.line,
            propDisplay: props.propDisplay,
            overUnder: props.overUnder,
            reasoning: props.reasoning,
            factors: props.factors,
            injuries: props.injuries,
            sport: props.sport,
            withoutTeammatesData: props.withoutTeammatesData,
            paceContext: props.paceContext,
            overallRating: overallSummary.rating,
            overallSummary: overallSummary.summary,
            decision: props.decision || null,
            team1Name: props.team1Name,
            team2Name: props.team2Name,
          },
        });

        if (cancelled) return;

        if (error || !data?.sections?.length) {
          setSections(generateFallbackSections(props));
          return;
        }

        // ── Validation guardrail: detect contradictions vs the locked decision ──
        const offendingSection = validateAgainstDecision(data.sections);
        if (offendingSection && attempts < MAX_RETRIES) {
          attempts++;
          const detail = {
            expected: props.decision?.winning_team_name,
            section: offendingSection,
            attempt: attempts,
            sport: props.sport,
            type: props.type,
          };
          // eslint-disable-next-line no-console
          console.warn("[decision-mismatch] Retrying AI analysis", detail);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("sentinel:decision-mismatch", { detail }));
          }
          // Auto-retry
          await fetchAnalysis();
          return;
        }

        if (offendingSection) {
          // Exhausted retries — fall back to safe deterministic prose
          // eslint-disable-next-line no-console
          console.warn("[decision-mismatch] Max retries reached, using fallback", {
            expected: props.decision?.winning_team_name,
            section: offendingSection,
          });
          setSections(generateFallbackSections(props));
          return;
        }

        setSections(data.sections);
      } catch {
        if (!cancelled) setSections(generateFallbackSections(props));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRegenerating(false);
        }
      }
    };

    fetchAnalysis();
    return () => { cancelled = true; };
  }, [props.playerOrTeam, props.confidence, props.verdict, props.type, overallSummary.rating, props.decision?.winning_team_name]);

  const borderColor = props.confidence >= 70
    ? "border-nba-green/30"
    : props.confidence >= 55
      ? "border-nba-blue/30"
      : "border-nba-yellow/30";

  const accentGradient = props.confidence >= 70
    ? "from-nba-green/20 to-transparent"
    : props.confidence >= 55
      ? "from-nba-blue/20 to-transparent"
      : "from-nba-yellow/20 to-transparent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
      className={`rounded-2xl border ${borderColor} overflow-hidden`}
      style={{ background: "hsla(228, 20%, 6%, 0.7)", backdropFilter: "blur(20px)" }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-4 py-3 border-b border-border/10 bg-gradient-to-r ${accentGradient}`}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-accent" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-accent">In-Depth Analysis</h3>
          {loading && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/50" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/50" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
                  <Brain className="w-4 h-4 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <p className="text-[11px] text-muted-foreground/50 animate-pulse">{regenerating ? "Regenerating analysis..." : "Generating analysis..."}</p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {sections.map((section, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.08, type: "spring", stiffness: 300 }}
                    className="group"
                  >
                    <div className="flex items-start gap-3">
                      {/* Section number indicator */}
                      <div className="flex flex-col items-center shrink-0 pt-0.5">
                        <div className={`w-7 h-7 rounded-lg bg-card/80 border border-border/20 flex items-center justify-center ${SECTION_COLORS[i] || "text-muted-foreground"}`}>
                          {SECTION_ICONS[i] || <FileText className="w-3.5 h-3.5" />}
                        </div>
                        {i < sections.length - 1 && (
                          <div className="w-px h-full min-h-[8px] bg-border/10 mt-1" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {section.title && (
                          <h4 className={`text-[11px] font-bold uppercase tracking-[0.12em] mb-1 ${SECTION_COLORS[i] || "text-muted-foreground"}`}>
                            {section.title}
                          </h4>
                        )}
                        <p className="text-[13px] leading-relaxed text-foreground">
                          {section.content.replace(/\*\*/g, "").replace(/\*/g, "").trim()}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}

                {/* Overall Verdict Summary */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + sections.length * 0.08 + 0.1, type: "spring", stiffness: 250 }}
                  className="rounded-xl p-4 relative overflow-hidden"
                  style={{
                    background: overallSummary.rating === "take"
                      ? "linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(158, 64%, 52%, 0.02))"
                      : overallSummary.rating === "lean"
                        ? "linear-gradient(135deg, hsla(210, 100%, 60%, 0.08), hsla(210, 100%, 60%, 0.02))"
                        : "linear-gradient(135deg, hsla(0, 72%, 51%, 0.08), hsla(0, 72%, 51%, 0.02))",
                    border: `1px solid ${
                      overallSummary.rating === "take" ? "hsla(158,64%,52%,0.2)" : overallSummary.rating === "lean" ? "hsla(210,100%,60%,0.2)" : "hsla(0,72%,51%,0.2)"
                    }`,
                  }}
                >
                  <div className="flex items-center gap-2.5 mb-2.5">
                    {overallSummary.rating === "take" ? (
                      <CheckCircle className="w-5 h-5 text-nba-green" />
                    ) : overallSummary.rating === "lean" ? (
                      <MinusCircle className="w-5 h-5 text-nba-blue" />
                    ) : (
                      <XCircle className="w-5 h-5 text-nba-red" />
                    )}
                    <div>
                      <span className={`text-[12px] font-extrabold uppercase tracking-wider ${
                        isNoBet ? "text-nba-red" : overallSummary.rating === "take" ? "text-nba-green" : overallSummary.rating === "lean" ? "text-nba-blue" : "text-nba-red"
                      }`}>
                        {isNoBet
                          ? "❌ No Bet Recommended"
                          : overallSummary.rating === "take" ? "✅ Take This Pick" : overallSummary.rating === "lean" ? "🤔 Lean Play" : "❌ Fade This Pick"}
                      </span>
                      <span className="block text-[9px] text-muted-foreground/65 font-bold uppercase tracking-wider mt-0.5">
                        Overall Verdict — All Factors Combined
                      </span>
                    </div>
                  </div>
                  <p className="text-[13px] leading-relaxed text-foreground">
                    {overallSummary.summary}
                  </p>
                  {props.decision?.grade_explanation && (
                    <p className="text-[10px] text-muted-foreground/55 mt-1.5 font-mono">
                      {props.decision.grade_explanation}
                    </p>
                  )}
                </motion.div>

                {/* Confidence footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border/10">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${props.confidence >= 70 ? "bg-nba-green" : props.confidence >= 55 ? "bg-nba-blue" : "bg-nba-yellow"} animate-pulse`} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/65">
                      AI Confidence: {props.confidence}%
                    </span>
                  </div>
                  <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50">
                    Powered by Sentinel AI
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default WrittenAnalysis;
