import { useState } from "react";
import { Calculator, DollarSign, Trophy, TrendingUp, AlertTriangle, CheckCircle, BarChart3, Target, Scale, Save, Check } from "lucide-react";
import { motion } from "framer-motion";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useParlaySlip } from "@/contexts/ParlaySlipContext";

interface LegAnalysis {
  legIndex: number;
  sport: "NBA" | "MLB" | "NHL" | "UFC" | "NFL";
  pick: string;
  odds: number;
  confidence: number;
  grade: "strong" | "lean" | "risky";
  summary: string;
  keyStats: string[];
  bestBook?: string;
}

interface Props {
  legs: LegAnalysis[];
  parlayOdds: number;
  potentialPayout: number;
  profit: number;
  overallConfidence: number;
  stake: number;
  overallWriteup: string;
}

function getGradeColor(grade: string) {
  if (grade === "strong") return "text-nba-green";
  if (grade === "lean") return "text-nba-yellow";
  return "text-nba-red";
}

function getGradeBg(grade: string) {
  if (grade === "strong") return "bg-nba-green text-accent-foreground";
  if (grade === "lean") return "bg-[hsl(var(--nba-yellow))] text-accent-foreground";
  return "bg-[hsl(var(--nba-red))] text-primary-foreground";
}

function getGradeGlow(grade: string) {
  if (grade === "strong") return "shadow-[0_0_15px_hsl(158_64%_52%/0.2)]";
  if (grade === "lean") return "shadow-[0_0_15px_hsl(43_96%_56%/0.2)]";
  return "shadow-[0_0_15px_hsl(0_72%_51%/0.2)]";
}

function getGradeBorderColor(grade: string) {
  if (grade === "strong") return "border-l-[hsl(var(--nba-green))]";
  if (grade === "lean") return "border-l-[hsl(var(--nba-yellow))]";
  return "border-l-[hsl(var(--nba-red))]";
}

const SPORT_COLORS: Record<string, string> = {
  NBA: "bg-[hsl(var(--nba-blue)/0.15)] text-nba-blue",
  MLB: "bg-[hsl(var(--nba-red)/0.15)] text-nba-red",
  NHL: "bg-[hsl(var(--nba-blue)/0.15)] text-nba-blue",
  UFC: "bg-accent/15 text-accent",
  NFL: "bg-[hsl(var(--nba-green)/0.15)] text-nba-green",
};

function getUnitSizing(overallConfidence: number, legCount: number, parlayOdds: number): { units: string; label: string; description: string; color: string } {
  const isLongShot = legCount >= 5 || parlayOdds > 800;
  if (isLongShot) return { units: "0.25–0.5", label: "Sprinkle", description: "High-leg parlays are high variance. Keep sizing small.", color: "text-nba-yellow" };
  if (overallConfidence >= 55 && legCount <= 3) return { units: "1–1.5", label: "Standard Play", description: "Solid data backing across legs. Standard sizing is appropriate.", color: "text-nba-green" };
  if (overallConfidence >= 40) return { units: "0.5–1", label: "Half Unit", description: "Mixed signals. Scale down to protect bankroll.", color: "text-nba-blue" };
  return { units: "0.25–0.5", label: "Light Play", description: "Low overall confidence. Consider trimming risky legs.", color: "text-nba-red" };
}

export default function ParlayAnalysisResults({ legs, parlayOdds, potentialPayout, profit, overallConfidence, stake, overallWriteup }: Props) {
  const { fmt } = useOddsFormat();
  const { user } = useAuth();
  const { clearSlip } = useParlaySlip();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const overallGrade = overallConfidence >= 60 ? "strong" : overallConfidence >= 40 ? "lean" : "risky";
  const unitSizing = getUnitSizing(overallConfidence, legs.length, parlayOdds);

  const handleSave = async () => {
    if (!user || saved) return;
    setSaving(true);
    try {
      await supabase.from("parlay_history" as any).insert({
        user_id: user.id, stake, parlay_odds: parlayOdds, potential_payout: potentialPayout,
        profit, overall_confidence: overallConfidence, overall_grade: overallGrade,
        overall_writeup: overallWriteup, unit_sizing: unitSizing.units,
        legs: JSON.stringify(legs), result: "pending",
      } as any);
      setSaved(true);
      clearSlip();
    } catch (e) { console.error("Failed to save parlay:", e); }
    finally { setSaving(false); }
  };

  const statCards = [
    { icon: BarChart3, label: "Confidence", value: `${overallConfidence.toFixed(0)}%`, color: getGradeColor(overallGrade), glow: getGradeGlow(overallGrade), highlight: true },
    { icon: Calculator, label: "Parlay Odds", value: fmt(parlayOdds), color: "text-accent", glow: "", highlight: false },
    { icon: DollarSign, label: "Payout", value: `$${potentialPayout.toFixed(2)}`, color: "text-nba-green", glow: "", highlight: false },
    { icon: Trophy, label: "Profit", value: `$${profit.toFixed(2)}`, color: "text-nba-yellow", glow: "", highlight: false },
  ];

  return (
    <div className="space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className={`rounded-2xl p-4 text-center border border-[hsla(228,18%,22%,0.5)] backdrop-blur-md relative overflow-hidden ${card.glow}`}
            style={{ background: 'var(--gradient-card)' }}
          >
            {card.highlight && (
              <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ background: `radial-gradient(circle at center, ${overallGrade === 'strong' ? 'hsl(158 64% 52%)' : overallGrade === 'lean' ? 'hsl(43 96% 56%)' : 'hsl(0 72% 51%)'}, transparent 70%)` }} />
            )}
            <card.icon className={`w-4 h-4 mx-auto mb-1 ${card.color}`} />
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{card.label}</span>
            <span className={`block text-2xl font-black ${card.color}`}>{card.value}</span>
          </motion.div>
        ))}
      </div>

      {/* Overall analysis */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.3 }}
        className={`rounded-2xl p-5 border border-[hsla(228,18%,22%,0.5)] backdrop-blur-md ${getGradeGlow(overallGrade)}`}
        style={{ background: 'var(--gradient-card)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          {overallGrade === "strong" ? <CheckCircle className="w-4 h-4 text-nba-green" /> :
           overallGrade === "lean" ? <TrendingUp className="w-4 h-4 text-nba-yellow" /> :
           <AlertTriangle className="w-4 h-4 text-nba-red" />}
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Parlay Analysis</h3>
          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ml-auto ${getGradeBg(overallGrade)}`}>{overallGrade}</span>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{overallWriteup}</p>
      </motion.div>

      {/* Unit sizing */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.3 }}
        className="rounded-2xl p-5 border border-[hsla(228,18%,22%,0.5)] backdrop-blur-md"
        style={{ background: 'var(--gradient-card)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Scale className={`w-4 h-4 ${unitSizing.color}`} />
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Recommended Sizing</h3>
        </div>
        <div className="flex items-center gap-4 mb-3">
          <div className="bg-[hsla(228,20%,14%,0.6)] border border-[hsla(228,18%,22%,0.5)] rounded-xl px-5 py-3 text-center">
            <span className={`block text-2xl font-black ${unitSizing.color}`}>{unitSizing.units}</span>
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Units</span>
          </div>
          <div className="flex-1">
            <span className={`block text-sm font-bold mb-1 ${unitSizing.color}`}>{unitSizing.label}</span>
            <p className="text-[12px] text-muted-foreground leading-relaxed">{unitSizing.description}</p>
          </div>
        </div>
        {stake > 0 && (
          <div className="flex items-center gap-2 pt-3 border-t border-[hsla(228,18%,20%,0.3)]">
            <Target className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span className="text-[11px] text-muted-foreground">
              At <span className="text-foreground font-semibold">${stake}</span>/unit → recommended wager: <span className={`font-bold ${unitSizing.color}`}>${(stake * parseFloat(unitSizing.units.split("–")[0])).toFixed(2)} – ${(stake * parseFloat(unitSizing.units.split("–")[1])).toFixed(2)}</span>
            </span>
          </div>
        )}
      </motion.div>

      {/* Leg breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.3 }}
        className="rounded-2xl p-5 border border-[hsla(228,18%,22%,0.5)] backdrop-blur-md"
        style={{ background: 'var(--gradient-card)' }}
      >
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Leg-by-Leg Breakdown</h3>
        <div className="space-y-3">
          {legs.map((leg, i) => (
            <motion.div
              key={leg.legIndex}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.08, duration: 0.25 }}
              className={`rounded-xl p-3.5 border-l-[3px] ${getGradeBorderColor(leg.grade)} border border-[hsla(228,18%,22%,0.4)] bg-[hsla(228,20%,12%,0.4)]`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground/60">#{leg.legIndex + 1}</span>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SPORT_COLORS[leg.sport] || "bg-accent/15 text-accent"}`}>{leg.sport}</span>
                </div>
                <div className="flex items-center gap-2">
                  {leg.bestBook && (
                    <span className="text-[9px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
                      Best: {leg.bestBook}
                    </span>
                  )}
                  <span className={`text-sm font-black ${getGradeColor(leg.grade)}`}>{leg.confidence.toFixed(0)}%</span>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${getGradeBg(leg.grade)}`}>{leg.grade}</span>
                </div>
              </div>
              <p className="text-[13px] font-semibold text-foreground mb-2 leading-snug">{leg.pick}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{leg.summary}</p>
              {leg.keyStats.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {leg.keyStats.map((stat, si) => (
                    <span key={si} className="text-[10px] bg-[hsla(228,20%,14%,0.6)] border border-[hsla(228,18%,20%,0.4)] rounded px-2 py-0.5 text-muted-foreground">{stat}</span>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Save button */}
      {user && (
        <motion.button
          onClick={handleSave}
          disabled={saved || saving}
          whileHover={!saved ? { scale: 1.02, y: -2 } : {}}
          whileTap={!saved ? { scale: 0.98 } : {}}
          className={`w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
            saved
              ? "bg-[hsl(var(--nba-green))]/15 border border-[hsl(var(--nba-green))]/40 text-nba-green cursor-default"
              : "text-accent-foreground hover:shadow-lg hover:shadow-accent/30 disabled:opacity-50"
          }`}
          style={!saved ? { background: 'var(--gradient-blue)' } : {}}
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? "SAVED TO HISTORY" : saving ? "SAVING..." : "SAVE PARLAY TO HISTORY"}
        </motion.button>
      )}
    </div>
  );
}
