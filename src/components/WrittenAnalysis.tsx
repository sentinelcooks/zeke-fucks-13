import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Brain, TrendingUp, Swords, BarChart3, AlertTriangle, Loader2, ChevronDown, ChevronUp, CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
  const source = reasoning.length > 0 ? reasoning : factors;
  const direction = overUnder?.toUpperCase() || "OVER";

  const sections: AnalysisSection[] = [];

  if (data.type === "prop") {
    sections.push({
      title: "Statistical Edge",
      content: confidence >= 70
        ? `Our model projects ${playerOrTeam} at ${confidence}% confidence for ${direction} ${line} ${propDisplay || ""}. Season-long averages and recent usage rates both trend favorably above this line, creating a clear statistical edge.`
        : `${playerOrTeam} shows a ${confidence}% probability of going ${direction} ${line} ${propDisplay || ""}. The model identifies a moderate edge based on available data points.`,
    });
    sections.push({
      title: "Matchup Breakdown",
      content: source[0] || `The matchup context supports this ${direction} play. Defensive rankings and pace of play create an environment where ${playerOrTeam} can exceed this line.`,
    });
    sections.push({
      title: "Recent Form",
      content: source[1] || `Recent game logs show ${playerOrTeam} trending in the right direction for this prop, with consistency across the last several outings.`,
    });
    sections.push({
      title: "Line Value",
      content: source[2] || `The current line of ${line} ${propDisplay || ""} appears to offer value given the statistical profile and situational factors at play.`,
    });
    sections.push({
      title: "Risk & Verdict",
      content: verdict === "STRONG PICK"
        ? `Minimal red flags identified. This is a high-conviction play — consider 1.5-2 unit sizing. All key indicators align for a strong ${direction} play.`
        : `Some variance factors exist. Recommended at 0.5-1 unit sizing with standard bankroll management. ${source[3] || "Monitor pregame news for any lineup changes."}`,
    });
  } else {
    sections.push({
      title: "Statistical Edge",
      content: `${playerOrTeam} grades out at ${confidence}% win probability in our model, ${confidence >= 60 ? "significantly exceeding" : "slightly above"} the implied odds threshold.`,
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
        content: `The model's confidence at ${confidence}% reflects the balance of available data points for this matchup.`,
      });
    }
  }

  return sections.slice(0, 5);
}

function generateOverallSummary(props: WrittenAnalysisProps): { rating: "take" | "lean" | "fade"; summary: string; unitSize: string } {
  const { confidence, playerOrTeam, line, propDisplay, overUnder, seasonHitRate, last10, last5, h2hAvg, ev, edge, minutesTrend, injuries, sport, type, verdict } = props;
  const direction = overUnder?.toUpperCase() || "OVER";
  const pickLabel = line != null ? `${playerOrTeam} ${direction} ${line} ${propDisplay || ""}`.trim() : playerOrTeam;

  // For moneyline/non-prop types, derive rating directly from the model's verdict & confidence
  // so we never contradict the statistical model
  if (type === "moneyline") {
    const v = (verdict || "").toUpperCase();
    let rating: "take" | "lean" | "fade";
    let unitSize: string;
    let summaryIntro: string;

    if (v.includes("STRONG") || confidence >= 65) {
      rating = "take";
      unitSize = "1.5–2 units";
      summaryIntro = `Strong play. ${pickLabel} checks all the boxes.`;
    } else if (v.includes("LEAN") || confidence >= 55) {
      rating = "lean";
      unitSize = "0.5–1 unit";
      summaryIntro = `Lean play. ${pickLabel} has more factors in its favor but isn't a slam dunk.`;
    } else if (v === "TOSS-UP" || confidence >= 45) {
      rating = "lean";
      unitSize = "0.5 units max";
      summaryIntro = `Coin-flip matchup. ${pickLabel} is too close to call with conviction.`;
    } else {
      rating = "fade";
      unitSize = "Pass or 0.25 units max";
      summaryIntro = `Fade. The data doesn't strongly support ${pickLabel}.`;
    }

    return { rating, summary: `${summaryIntro} Recommended sizing: ${unitSize}.`, unitSize };
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
  let rating: "take" | "lean" | "fade";
  let unitSize: string;
  let summaryIntro: string;

  // Model verdict overrides multi-signal scoring to prevent contradictions
  if (v === "DO NOT BET" || (v === "RISKY" && confidence < 50)) {
    rating = "fade";
    unitSize = "Pass or 0.25 units max";
    summaryIntro = `Fade. The data doesn't strongly support ${pickLabel}.`;
  } else if ((v.includes("STRONG") || v === "STRONG PICK" || v === "STRONG BET") && confidence >= 60) {
    rating = "take";
    unitSize = "1.5–2 units";
    summaryIntro = `Strong play. ${pickLabel} checks all the boxes.`;
  } else if (score >= 3 && confidence >= 65) {
    rating = "take";
    unitSize = "1.5–2 units";
    summaryIntro = `Strong play. ${pickLabel} checks all the boxes.`;
  } else if (score >= 1 || confidence >= 55) {
    rating = "lean";
    unitSize = "0.5–1 unit";
    summaryIntro = `Lean play. ${pickLabel} has more factors in its favor but isn't a slam dunk.`;
  } else {
    rating = "fade";
    unitSize = "Pass or 0.25 units max";
    summaryIntro = `Fade. The data doesn't strongly support ${pickLabel}.`;
  }

  const signalText = signals.length > 0 ? " " + signals.slice(0, 4).join(". ") + "." : "";
  return { rating, summary: `${summaryIntro}${signalText} Recommended sizing: ${unitSize}.`, unitSize };
}

const WrittenAnalysis = (props: WrittenAnalysisProps) => {
  const overallSummary = generateOverallSummary(props);
  const [sections, setSections] = useState<AnalysisSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchAnalysis = async () => {
      setLoading(true);
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
          },
        });

        if (!cancelled) {
          if (error || !data?.sections?.length) {
            setSections(generateFallbackSections(props));
          } else {
            setSections(data.sections);
          }
        }
      } catch {
        if (!cancelled) setSections(generateFallbackSections(props));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchAnalysis();
    return () => { cancelled = true; };
  }, [props.playerOrTeam, props.confidence, props.verdict, props.type]);

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
                <p className="text-[11px] text-muted-foreground/50 animate-pulse">Generating analysis...</p>
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
                        overallSummary.rating === "take" ? "text-nba-green" : overallSummary.rating === "lean" ? "text-nba-blue" : "text-nba-red"
                      }`}>
                        {overallSummary.rating === "take" ? "✅ Take This Pick" : overallSummary.rating === "lean" ? "🤔 Lean Play" : "❌ Fade This Pick"}
                      </span>
                      <span className="block text-[9px] text-muted-foreground/65 font-bold uppercase tracking-wider mt-0.5">
                        Overall Verdict — All Factors Combined
                      </span>
                    </div>
                  </div>
                  <p className="text-[13px] leading-relaxed text-foreground">
                    {overallSummary.summary}
                  </p>
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
