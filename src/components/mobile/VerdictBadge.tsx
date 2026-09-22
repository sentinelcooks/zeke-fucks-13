import { motion } from "framer-motion";
import { normalizeConfidencePercent, normalizeVerdict } from "@/lib/matchupGrade";

interface VerdictBadgeProps {
  confidence: number;
  verdict: string;
  overUnder: string;
  line: number;
  propDisplay: string;
  probabilitySupported?: boolean;
  scoreKind?: string;
  displayMode?: "model_score" | "historical_hit_rate";
  /**
   * Season hit rate, shown as a labelled secondary line. It used to be
   * substituted for the headline on MLB, which made a "70 model score" card
   * open on an unlabelled "72%" — two different metrics, neither named.
   */
  seasonHitRate?: number | null;
  /** Model score stored on the pick, when this view re-ran the analyzer. */
  savedConfidence?: number | null;
  /** Absolute points of drift between the stored and re-run score. */
  driftFromSaved?: number | null;
}

function getVerdictTheme(v: string) {
  switch (normalizeVerdict(v)) {
    case "STRONG":
      return {
        bg: "bg-nba-green-dim",
        border: "border-[hsla(158,64%,52%,0.2)]",
        text: "text-nba-green",
        glow: "glow-green",
        gradient: "from-[hsla(158,64%,52%,0.15)] to-transparent",
      };
    case "LEAN":
      return {
        bg: "bg-nba-blue-dim",
        border: "border-[hsla(211,100%,60%,0.2)]",
        text: "text-nba-blue",
        glow: "glow-blue",
        gradient: "from-[hsla(211,100%,60%,0.15)] to-transparent",
      };
    case "RISKY":
      return {
        bg: "bg-nba-yellow-dim",
        border: "border-[hsla(43,96%,56%,0.2)]",
        text: "text-nba-yellow",
        glow: "",
        gradient: "from-[hsla(43,96%,56%,0.1)] to-transparent",
      };
    case "PASS":
      return {
        bg: "bg-nba-red-dim",
        border: "border-destructive/30",
        text: "text-nba-red",
        glow: "glow-red",
        gradient: "from-[hsla(0,72%,51%,0.2)] to-transparent",
      };
    default:
      return {
        bg: "bg-nba-red-dim",
        border: "border-destructive/20",
        text: "text-nba-red",
        glow: "glow-red",
        gradient: "from-[hsla(0,72%,51%,0.15)] to-transparent",
      };
  }
}

export function VerdictBadge({
  confidence,
  verdict,
  overUnder,
  line,
  propDisplay,
  probabilitySupported = false,
  scoreKind,
  displayMode = "model_score",
  seasonHitRate = null,
  savedConfidence = null,
  driftFromSaved = null,
}: VerdictBadgeProps) {
  const confPct = Math.round(normalizeConfidencePercent(confidence));
  const canonicalVerdict = normalizeVerdict(verdict, confPct);
  const theme = getVerdictTheme(canonicalVerdict);
  const showHistoricalHitRate = displayMode === "historical_hit_rate";
  const isProbability = probabilitySupported && scoreKind === "calibrated_probability";
  const metricLabel = showHistoricalHitRate
    ? "Season hit rate"
    : isProbability
      ? "Validated probability"
      : "Heuristic model score";
  const seasonPct = seasonHitRate != null && Number.isFinite(Number(seasonHitRate))
    ? Math.round(normalizeConfidencePercent(seasonHitRate))
    : null;
  // Only worth showing when the re-run actually moved the number.
  const savedPct = savedConfidence != null && Number.isFinite(Number(savedConfidence))
    ? Math.round(normalizeConfidencePercent(savedConfidence))
    : null;
  const showDrift = savedPct != null && savedPct !== confPct &&
    (driftFromSaved == null || Math.round(Number(driftFromSaved)) !== 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`relative rounded-2xl overflow-hidden border ${theme.border} ${theme.glow} p-6 text-center`}
      style={{ background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)' }}
    >
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-b ${theme.gradient} pointer-events-none`} />
      
      <div className="relative z-10">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 400, damping: 20 }}
          className={`text-5xl font-black ${theme.text} tabular-nums`}
        >
          {showHistoricalHitRate || isProbability ? `${confPct}%` : `${confPct}/100`}
        </motion.div>
        {/* Always name the metric. An unlabelled big number next to a card
            showing a different one is what made these screens contradict. */}
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mt-1">
          {metricLabel}
        </div>
        <div className={`text-sm font-black tracking-[3px] mt-1 ${theme.text}`}>
          {canonicalVerdict}
        </div>
        <div className="text-xs text-muted-foreground/60 mt-2.5 font-medium">
          {overUnder.toUpperCase()} {line} {propDisplay}
        </div>
        {seasonPct !== null && !showHistoricalHitRate && (
          <div className="text-[10px] text-muted-foreground/55 mt-1.5">
            Season hit rate {seasonPct}% · a historical frequency, not this score
          </div>
        )}
        {showDrift && (
          <div className="text-[10px] text-muted-foreground/55 mt-1">
            Published at {savedPct}/100 · re-run just now scores {confPct}/100
          </div>
        )}
      </div>
    </motion.div>
  );
}
