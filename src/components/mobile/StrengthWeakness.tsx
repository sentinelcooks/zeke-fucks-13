import { motion } from "framer-motion";
import { Shield, Swords, TrendingUp, TrendingDown } from "lucide-react";
import { buildMatchupGrade } from "@/lib/matchupGrade";

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
  paceContext?: unknown;
  sport?: "nba" | "mlb" | "nhl" | "ufc";
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

export function StrengthWeakness({
  playerName,
  opponentName,
  playerStrengths,
  teamWeaknesses,
  paceContext,
  sport,
}: StrengthWeaknessProps) {
  const grade = buildMatchupGrade(sport, paceContext as never);

  return (
    <div className="space-y-4">
      {/* Matchup Grade */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl bg-card border border-border p-4"
      >
        <div className="flex items-center justify-between mb-1">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-foreground">Matchup Grade</h4>
            <p className="text-[10px] text-foreground/70 mt-0.5">{playerName} vs {opponentName}</p>
          </div>
          {grade.source !== "unavailable" ? (
            <div className="flex items-center gap-3">
              {grade.metrics.map((m, idx) => (
                <div key={m.label} className="flex items-center gap-3">
                  {idx > 0 && <div className="w-px h-10 bg-border" />}
                  <div className="text-center">
                    <span className="block text-[9px] font-bold uppercase text-foreground/70">{m.label}</span>
                    <span className={`block text-lg font-black tabular-nums ${idx === 0 ? "text-nba-green" : "text-nba-blue"}`}>{m.value}</span>
                  </div>
                </div>
              ))}
              {grade.source === "estimated" && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-nba-yellow border border-nba-yellow/40 rounded px-1.5 py-0.5">Estimated</span>
              )}
            </div>
          ) : (
            <div className="text-right">
              <span className="block text-[10px] font-semibold text-muted-foreground/70">Matchup data unavailable</span>
              <span className="block text-[9px] text-muted-foreground/50 mt-0.5">for this market</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Player Strengths — only when caller provides real data */}
      {playerStrengths && playerStrengths.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Swords className="w-3.5 h-3.5 text-nba-green" />
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Player Strengths vs {opponentName}
            </h4>
          </div>
          <div className="space-y-3">
            {playerStrengths.map((factor, i) => (
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
      )}

      {/* Team Weaknesses — only when caller provides real data */}
      {teamWeaknesses && teamWeaknesses.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-3.5 h-3.5 text-nba-red" />
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {opponentName} Weaknesses
            </h4>
          </div>
          <div className="space-y-3">
            {teamWeaknesses.map((factor, i) => (
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
      )}
    </div>
  );
}
