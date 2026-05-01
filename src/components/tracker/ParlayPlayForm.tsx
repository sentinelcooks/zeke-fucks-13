import { useState } from "react";
import { Plus, X, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PlayerAutocomplete, getLinePlaceholder } from "./PlayerAutocomplete";
import { BetTypeDropdown } from "./BetTypeDropdown";
import {
  isGameTotal, isTeamMarket, isUfcFightTotal, isUfcFighterStat,
  getDirectionMode, getSubjectMode, DirectionMode,
} from "./marketType";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { americanToDecimal } from "@/utils/oddsFormat";

const UFC_METHODS = [
  "KO/TKO",
  "Submission",
  "Decision",
  "KO/TKO or Submission",
  "KO/TKO or Decision",
  "Submission or Decision",
];

const ROUND_NUMBERS = ["1", "2", "3", "4", "5"];

interface ParlayLeg {
  sport: string;
  player: string;
  betType: string;
  odds: string;
  line: string;
  direction: "over" | "under";
  method: string;
  roundNumber: string;
  roundResult: string;
}

interface ParlayPlayFormProps {
  onSave: (legs: ParlayLeg[], stake: number, combinedOdds: number) => void;
  onCancel: () => void;
}

export function ParlayPlayForm({ onSave, onCancel }: ParlayPlayFormProps) {
  const { oddsFormat } = useOddsFormat();
  const defaultOdds = oddsFormat === "decimal" ? "1.91" : "-110";
  const emptyLeg = (): ParlayLeg => ({
    sport: "nba", player: "", betType: "", odds: defaultOdds,
    line: "", direction: "over", method: "", roundNumber: "", roundResult: "",
  });
  const [legs, setLegs] = useState<ParlayLeg[]>([emptyLeg(), emptyLeg()]);
  const [stake, setStake] = useState("");

  const updateLeg = (idx: number, field: keyof ParlayLeg, val: string) => {
    setLegs((prev) =>
      prev.map((leg, i) => {
        if (i !== idx) return leg;
        if (field === "sport") return { ...emptyLeg(), sport: val, odds: leg.odds };
        if (field === "betType") {
          const modeChanged =
            isTeamMarket(leg.betType) !== isTeamMarket(val) ||
            isGameTotal(leg.betType) !== isGameTotal(val) ||
            getSubjectMode(leg.sport, leg.betType) !== getSubjectMode(leg.sport, val);
          return {
            ...leg, betType: val,
            player: modeChanged ? "" : leg.player,
            line: "", direction: "over", method: "", roundNumber: "", roundResult: "",
          };
        }
        return { ...leg, [field]: val };
      })
    );
  };

  const addLeg = () => setLegs((prev) => [...prev, emptyLeg()]);
  const removeLeg = (idx: number) => { if (legs.length > 2) setLegs((prev) => prev.filter((_, i) => i !== idx)); };

  const combinedDecimal = legs.reduce((acc, leg) => {
    const raw = parseFloat(leg.odds);
    if (isNaN(raw)) return acc;
    const dec = oddsFormat === "decimal" ? raw : americanToDecimal(raw);
    return acc * dec;
  }, 1);

  const combinedAmerican = combinedDecimal >= 2
    ? Math.round((combinedDecimal - 1) * 100)
    : Math.round(-100 / (combinedDecimal - 1));

  const stakeNum = parseFloat(stake) || 0;
  const potentialPayout = stakeNum * combinedDecimal;
  const canSave = legs.every((l) => l.player && l.betType) && stakeNum > 0;

  // Encode leg bet_type with UFC-specific fields before passing to parent
  const encodedLegs = (): ParlayLeg[] =>
    legs.map((leg) => {
      const dirMode = getDirectionMode(leg.sport, leg.betType);
      let finalBetType = leg.betType;
      if (dirMode === "method" && leg.method) {
        finalBetType = `${leg.betType}: ${leg.method}`;
      } else if (dirMode === "round_prop" && leg.roundNumber) {
        const result = leg.roundResult === "ends" ? "Ends" : "Starts";
        finalBetType = `Round Props: Round ${leg.roundNumber} ${result}`;
      } else if (dirMode === "over_under") {
        finalBetType = `${leg.betType} (${leg.direction.toUpperCase()})`;
      }
      return { ...leg, betType: finalBetType };
    });

  return (
    <div className="vision-card p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.25)' }}>
            <Layers className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[13px] font-bold text-foreground">New Parlay</span>
        </div>
        <button onClick={onCancel} className="p-1.5 rounded-lg text-muted-foreground/45 hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <AnimatePresence>
        {legs.map((leg, idx) => {
          const dirMode: DirectionMode = getDirectionMode(leg.sport, leg.betType);
          const isFightTotalLeg = isUfcFightTotal(leg.betType);
          const isFighterStatLeg = isUfcFighterStat(leg.betType);

          // Line label
          const lineLabel = isFightTotalLeg
            ? "Total Rounds"
            : isGameTotal(leg.betType)
            ? "Total Line"
            : isFighterStatLeg
            ? `${leg.betType} Line`
            : "Line";

          const linePlaceholder = getLinePlaceholder(leg.sport, leg.betType) || (isGameTotal(leg.betType) ? "224.5" : "0.5");

          return (
            <motion.div key={idx} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="relative rounded-xl p-3 space-y-2" style={{ background: 'hsla(228, 20%, 10%, 0.4)', border: '1px solid hsla(228, 20%, 20%, 0.2)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-accent/70">LEG {idx + 1}</span>
                {legs.length > 2 && (
                  <button onClick={() => removeLeg(idx)} className="text-muted-foreground/40 hover:text-nba-red transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Sport</label>
                  <select value={leg.sport} onChange={(e) => updateLeg(idx, "sport", e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground outline-none appearance-none"
                    style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                    <option value="nba">NBA</option><option value="mlb">MLB</option><option value="nhl">NHL</option>
                    <option value="ufc">UFC</option><option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">
                    Odds ({oddsFormat === "decimal" ? "Decimal" : "American"})
                  </label>
                  <input type="number" value={leg.odds} onChange={(e) => updateLeg(idx, "odds", e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none"
                    style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
                    step={oddsFormat === "decimal" ? "0.01" : "1"} />
                </div>
                <PlayerAutocomplete sport={leg.sport} value={leg.player} onChange={(v) => updateLeg(idx, "player", v)} betType={leg.betType} />
                <BetTypeDropdown sport={leg.sport} value={leg.betType} onChange={(v) => updateLeg(idx, "betType", v)} />

                {/* Over/Under: player props, game totals, UFC fighter stats, UFC fight totals */}
                {dirMode === "over_under" && (
                  <>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">{lineLabel}</label>
                      <input type="number" step="0.5" placeholder={linePlaceholder} value={leg.line}
                        onChange={(e) => updateLeg(idx, "line", e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none"
                        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }} />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Direction</label>
                      <div className="flex rounded-xl overflow-hidden h-[42px]" style={{ border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                        <button type="button" onClick={() => updateLeg(idx, "direction", "over")}
                          className={`flex-1 text-[11px] font-bold tracking-wide transition-all ${leg.direction === "over" ? "text-emerald-400" : "text-muted-foreground/50 hover:text-foreground/70"}`}
                          style={{ background: leg.direction === "over" ? 'hsla(160, 84%, 39%, 0.12)' : 'hsla(228, 20%, 10%, 0.6)' }}>
                          OVER
                        </button>
                        <button type="button" onClick={() => updateLeg(idx, "direction", "under")}
                          className={`flex-1 text-[11px] font-bold tracking-wide transition-all ${leg.direction === "under" ? "text-red-400" : "text-muted-foreground/50 hover:text-foreground/70"}`}
                          style={{ background: leg.direction === "under" ? 'hsla(0, 84%, 60%, 0.12)' : 'hsla(228, 20%, 10%, 0.6)' }}>
                          UNDER
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Method selector for UFC method markets */}
                {dirMode === "method" && (
                  <div className="col-span-2">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Method</label>
                    <select value={leg.method} onChange={(e) => updateLeg(idx, "method", e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground outline-none appearance-none"
                      style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                      <option value="">Select method...</option>
                      {UFC_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}

                {/* Goes Distance: binary button */}
                {dirMode === "goes_distance" && (
                  <div className="col-span-2">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Result</label>
                    <div className="flex rounded-xl overflow-hidden h-[42px]" style={{ border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                      <button type="button" onClick={() => updateLeg(idx, "direction", "over")}
                        className={`flex-1 text-[11px] font-bold tracking-wide transition-all ${leg.direction === "over" ? "text-emerald-400" : "text-muted-foreground/50 hover:text-foreground/70"}`}
                        style={{ background: leg.direction === "over" ? 'hsla(160, 84%, 39%, 0.12)' : 'hsla(228, 20%, 10%, 0.6)' }}>
                        GOES DISTANCE
                      </button>
                      <button type="button" onClick={() => updateLeg(idx, "direction", "under")}
                        className={`flex-1 text-[11px] font-bold tracking-wide transition-all ${leg.direction === "under" ? "text-red-400" : "text-muted-foreground/50 hover:text-foreground/70"}`}
                        style={{ background: leg.direction === "under" ? 'hsla(0, 84%, 60%, 0.12)' : 'hsla(228, 20%, 10%, 0.6)' }}>
                        DOES NOT
                      </button>
                    </div>
                  </div>
                )}

                {/* Inside Distance: binary button */}
                {dirMode === "inside_distance" && (
                  <div className="col-span-2">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Result</label>
                    <div className="flex rounded-xl overflow-hidden h-[42px]" style={{ border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                      <button type="button" onClick={() => updateLeg(idx, "direction", "over")}
                        className={`flex-1 text-[11px] font-bold tracking-wide transition-all ${leg.direction === "over" ? "text-emerald-400" : "text-muted-foreground/50 hover:text-foreground/70"}`}
                        style={{ background: leg.direction === "over" ? 'hsla(160, 84%, 39%, 0.12)' : 'hsla(228, 20%, 10%, 0.6)' }}>
                        INSIDE DISTANCE
                      </button>
                      <button type="button" onClick={() => updateLeg(idx, "direction", "under")}
                        className={`flex-1 text-[11px] font-bold tracking-wide transition-all ${leg.direction === "under" ? "text-red-400" : "text-muted-foreground/50 hover:text-foreground/70"}`}
                        style={{ background: leg.direction === "under" ? 'hsla(0, 84%, 60%, 0.12)' : 'hsla(228, 20%, 10%, 0.6)' }}>
                        NOT INSIDE
                      </button>
                    </div>
                  </div>
                )}

                {/* Round prop: round selector + ends/starts */}
                {dirMode === "round_prop" && (
                  <>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Round</label>
                      <select value={leg.roundNumber} onChange={(e) => updateLeg(idx, "roundNumber", e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground outline-none appearance-none"
                        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                        <option value="">Round...</option>
                        {ROUND_NUMBERS.map((r) => <option key={r} value={r}>Round {r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Result</label>
                      <select value={leg.roundResult} onChange={(e) => updateLeg(idx, "roundResult", e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground outline-none appearance-none"
                        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                        <option value="">Result...</option>
                        <option value="ends">Fight Ends This Round</option>
                        <option value="starts">Fight Starts This Round</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      <button onClick={addLeg}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold text-accent/70 hover:text-accent transition-colors"
        style={{ border: '1px dashed hsla(228, 30%, 22%, 0.4)' }}>
        <Plus className="w-3 h-3" /> Add Leg
      </button>

      <div className="grid grid-cols-3 gap-2 rounded-xl p-2.5" style={{ background: 'hsla(228, 20%, 10%, 0.5)' }}>
        <div className="text-center">
          <span className="block text-[8px] uppercase tracking-wider text-muted-foreground/50">Combined</span>
          <span className="block text-[12px] font-extrabold text-accent">
            {oddsFormat === "decimal" ? combinedDecimal.toFixed(2) : (combinedAmerican > 0 ? `+${combinedAmerican}` : combinedAmerican)}
          </span>
        </div>
        <div className="text-center">
          <label className="block text-[8px] uppercase tracking-wider text-muted-foreground/50">Stake ($)</label>
          <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="10"
            className="w-full text-center text-[12px] font-extrabold text-foreground bg-transparent outline-none" />
        </div>
        <div className="text-center">
          <span className="block text-[8px] uppercase tracking-wider text-muted-foreground/50">Payout</span>
          <span className="block text-[12px] font-extrabold text-nba-green">${potentialPayout.toFixed(2)}</span>
        </div>
      </div>

      <motion.button whileTap={{ scale: 0.95 }} onClick={() => {
        if (!canSave) return;
        onSave(encodedLegs(), stakeNum, combinedAmerican);
      }}
        className={`w-full py-3 rounded-xl text-[12px] font-bold tracking-wider text-accent-foreground transition-opacity ${!canSave ? 'opacity-40' : ''}`}
        style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.3)' }}
        disabled={!canSave}>
        Save Parlay
      </motion.button>
    </div>
  );
}
