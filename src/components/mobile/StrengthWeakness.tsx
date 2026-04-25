import { motion } from "framer-motion";
import { Shield, Swords, TrendingUp, TrendingDown } from "lucide-react";

interface MatchupFactor {
  label: string;
  value: number; // 0–100 rating
  description: string;
  trend: "up" | "down" | "neutral";
}

interface StrengthWeaknessProps {
  playerName: string;
  opponentName: string;
  playerStrengths?: MatchupFactor[];
  teamWeaknesses?: MatchupFactor[];
  defRank?: number | null;
  defRankLabel?: string;
  paceRank?: number | null;
  defLabel?: string;
  sport?: "nba" | "mlb" | "nhl" | "ufc";
}

function formatMetric(val: number | null | undefined): string {
  if (val == null) return "—";
  if (Number.isInteger(val) && val >= 1 && val <= 30) return `#${val}`;
  return typeof val === "number" ? val.toFixed(1) : String(val);
}

function getRatingColor(val: number): string {
  if (val >= 75) return "bg-nba-green";
  if (val >= 50) return "bg-nba-blue";
  if (val >= 35) return "bg-nba-yellow";
  return "bg-nba-red";
}

function getRatingText(val: number): string {
  if (val >= 75) return "text-nba-green";
  if (val >= 50) return "text-nba-blue";
  if (val >= 35) return "text-nba-yellow";
  return "text-nba-red";
}

// NBA defaults
const nbaStrengths: MatchupFactor[] = [
  { label: "Scoring in Paint", value: 82, description: "Avg 14.2 pts in paint, 3rd in league", trend: "up" },
  { label: "Free Throws Drawn", value: 71, description: "7.8 FTA/game vs this team's defensive fouls", trend: "up" },
  { label: "Transition Points", value: 65, description: "Fast break efficiency above season avg", trend: "neutral" },
];
const nbaWeaknesses: MatchupFactor[] = [
  { label: "Perimeter Defense", value: 28, description: "Allow 38.2% from 3, 27th in NBA", trend: "down" },
  { label: "Paint Protection", value: 35, description: "Below avg rim protection, 22nd in NBA", trend: "down" },
  { label: "Transition Defense", value: 42, description: "Give up 16.5 fast break pts/game", trend: "neutral" },
];

// MLB defaults
const mlbStrengths: MatchupFactor[] = [
  { label: "Contact Rate", value: 78, description: "High batting avg and low K-rate vs similar pitchers", trend: "up" },
  { label: "Power vs RHP/LHP", value: 72, description: "Strong ISO and SLG% in platoon matchup", trend: "up" },
  { label: "Run Production", value: 66, description: "RBI and runs scored above positional avg", trend: "neutral" },
];
const mlbWeaknesses: MatchupFactor[] = [
  { label: "Starting Pitcher", value: 30, description: "Opposing SP has high ERA and WHIP this season", trend: "down" },
  { label: "Bullpen Depth", value: 38, description: "Relief pitching ranks bottom-third in league", trend: "down" },
  { label: "K-Rate vs Pitch Type", value: 44, description: "High strikeout rate vs dominant pitch mix", trend: "neutral" },
];

// NHL defaults
const nhlStrengths: MatchupFactor[] = [
  { label: "Power Play", value: 80, description: "PP conversion rate above league average", trend: "up" },
  { label: "Shot Volume", value: 73, description: "High shots on goal per game in recent stretch", trend: "up" },
  { label: "Even Strength Scoring", value: 64, description: "5v5 goals per 60 above team avg", trend: "neutral" },
];
const nhlWeaknesses: MatchupFactor[] = [
  { label: "Penalty Kill", value: 32, description: "PK% ranks in bottom third of NHL", trend: "down" },
  { label: "Goaltending", value: 36, description: "Starting goalie save % below league avg", trend: "down" },
  { label: "Defensive Zone Exits", value: 40, description: "Struggle to transition out of own zone cleanly", trend: "neutral" },
];

// UFC defaults
const ufcStrengths: MatchupFactor[] = [
  { label: "Striking Accuracy", value: 76, description: "Significant strike accuracy above division avg", trend: "up" },
  { label: "Takedown Defense", value: 70, description: "High TDD% against wrestling-heavy opponents", trend: "neutral" },
  { label: "Cardio / Output", value: 68, description: "Volume stays consistent through later rounds", trend: "up" },
];
const ufcWeaknesses: MatchupFactor[] = [
  { label: "Ground Game", value: 30, description: "Low submission attempts and bottom control", trend: "down" },
  { label: "Chin Durability", value: 35, description: "Has been dropped/finished in recent bouts", trend: "down" },
  { label: "Clinch Work", value: 42, description: "Loses position frequently in the clinch", trend: "neutral" },
];

function getDefaults(sport?: string) {
  switch (sport) {
    case "mlb": return { strengths: mlbStrengths, weaknesses: mlbWeaknesses, paceLabel: "runs/game" };
    case "nhl": return { strengths: nhlStrengths, weaknesses: nhlWeaknesses, paceLabel: "fastest" };
    case "ufc": return { strengths: ufcStrengths, weaknesses: ufcWeaknesses, paceLabel: "output" };
    default: return { strengths: nbaStrengths, weaknesses: nbaWeaknesses, paceLabel: "fastest" };
  }
}

export function StrengthWeakness({
  playerName,
  opponentName,
  playerStrengths,
  teamWeaknesses,
  defRank = null,
  defRankLabel,
  paceRank = null,
  defLabel,
  sport,
}: StrengthWeaknessProps) {
  const defaults = getDefaults(sport);
  const strengths = playerStrengths || defaults.strengths;
  const weaknesses = teamWeaknesses || defaults.weaknesses;

  const displayDefLabel = defLabel || (sport === "mlb" ? "OPP ERA" : sport === "nhl" ? "OPP DEF RTG" : "OPP DEF RTG");
  const paceLabel = sport === "mlb" ? "RUNS/G" : "PACE";
  const hasMetrics = defRank != null || paceRank != null;

  return (
    <div className="space-y-4">
      {/* Matchup Grade */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl bg-card border border-border p-4"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-foreground">Matchup Grade</h4>
            <p className="text-[10px] text-foreground/70 mt-0.5">{playerName} vs {opponentName}</p>
          </div>
          {hasMetrics ? (
            <div className="flex items-center gap-3">
              {defRank != null && (
                <div className="text-center">
                  <span className="block text-[9px] font-bold uppercase text-foreground/70">{displayDefLabel}</span>
                  <span className="block text-lg font-black text-nba-green tabular-nums">{formatMetric(defRank)}</span>
                  {defRankLabel && <span className="block text-[8px] text-foreground/60">{defRankLabel}</span>}
                </div>
              )}
              {defRank != null && paceRank != null && <div className="w-px h-10 bg-border" />}
              {paceRank != null && (
                <div className="text-center">
                  <span className="block text-[9px] font-bold uppercase text-foreground/70">{paceLabel}</span>
                  <span className="block text-lg font-black text-nba-blue tabular-nums">{formatMetric(paceRank)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-right">
              <span className="block text-[10px] font-semibold text-muted-foreground/50">Insufficient data</span>
              <span className="block text-[9px] text-muted-foreground/35 mt-0.5">Matchup metrics unavailable</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Player Strengths */}
      <div className="rounded-2xl bg-card border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Swords className="w-3.5 h-3.5 text-nba-green" />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Player Strengths vs {opponentName}
          </h4>
        </div>
        <div className="space-y-3">
          {strengths.map((factor, i) => (
            <motion.div
              key={factor.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{factor.label}</span>
                  {factor.trend === "up" && <TrendingUp className="w-3 h-3 text-nba-green" />}
                  {factor.trend === "down" && <TrendingDown className="w-3 h-3 text-nba-red" />}
                </div>
                <span className={`text-xs font-bold tabular-nums ${getRatingText(factor.value)}`}>{factor.value}</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${factor.value}%` }}
                  transition={{ delay: i * 0.08 + 0.2, duration: 0.6, ease: "easeOut" }}
                  className={`h-full rounded-full ${getRatingColor(factor.value)}`}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{factor.description}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Team Weaknesses */}
      <div className="rounded-2xl bg-card border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-3.5 h-3.5 text-nba-red" />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {opponentName} Weaknesses
          </h4>
        </div>
        <div className="space-y-3">
          {weaknesses.map((factor, i) => (
            <motion.div
              key={factor.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{factor.label}</span>
                  {factor.trend === "down" && <TrendingDown className="w-3 h-3 text-nba-red" />}
                </div>
                <span className={`text-xs font-bold tabular-nums ${getRatingText(100 - factor.value)}`}>{factor.value}</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${factor.value}%` }}
                  transition={{ delay: i * 0.08 + 0.2, duration: 0.6, ease: "easeOut" }}
                  className={`h-full rounded-full ${getRatingColor(100 - factor.value)}`}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{factor.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
