import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3, AlertTriangle, ChevronDown, ChevronUp, Loader2,
  Activity, TrendingUp, Wind, Thermometer, Target, Zap, Users,
  ArrowRight, Shield,
} from "lucide-react";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { VerdictBadge } from "@/components/mobile/VerdictBadge";
import { HitRateRing } from "@/components/mobile/HitRateRing";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";

interface Game {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status: string;
  venue: string;
  parkFactor: number;
  weather: { temperature: number | null; condition: string; wind: any } | null;
  home: { id: string; name: string; abbreviation: string; logo: string; record: string; score: string };
  away: { id: string; name: string; abbreviation: string; logo: string; record: string; score: string };
  pitchers: {
    home: { name: string; era: number; whip: number; k9: number };
    away: { name: string; era: number; whip: number; k9: number };
  };
}

interface FactorBreakdown {
  factor: string;
  label: string;
  weight: number;
  team1Score: number;
  team2Score: number;
  advantageScore: number;
  contribution: number;
}

interface Prediction {
  bet_type: string;
  confidence: number;
  verdict: string;
  factorBreakdown: FactorBreakdown[];
  writeup: string;
  injuries: { team1: any[]; team2: any[]; warnings: string[] };
  pitchers: any;
  context: any;
}

const BET_TYPES = [
  { id: "moneyline", label: "Moneyline" },
  { id: "runline", label: "Run Line" },
  { id: "total", label: "O/U" },
  { id: "player_prop", label: "Props" },
];

function getFactorColor(score: number): string {
  if (score >= 65) return "hsl(var(--chart-2))";
  if (score >= 45) return "hsl(var(--chart-4))";
  return "hsl(var(--destructive))";
}

function getFactorBg(score: number): string {
  if (score >= 65) return "bg-green-500/10";
  if (score >= 45) return "bg-yellow-500/10";
  return "bg-red-500/10";
}

function GameCard({ game, isSelected, onClick }: { game: Game; isSelected: boolean; onClick: () => void }) {
  const gameTime = new Date(game.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <motion.button
      onClick={onClick}
      className={`w-full min-w-0 rounded-2xl border p-3 text-left transition-all ${
        isSelected
          ? "border-primary/40 bg-primary/5"
          : "border-border/30 bg-card/50 hover:border-border/50"
      }`}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {game.away.logo && <img src={game.away.logo} alt="" className="w-6 h-6 shrink-0" />}
          <span className="text-xs font-bold text-foreground truncate">{game.away.abbreviation}</span>
          <span className="text-[10px] text-muted-foreground">@</span>
          {game.home.logo && <img src={game.home.logo} alt="" className="w-6 h-6 shrink-0" />}
          <span className="text-xs font-bold text-foreground truncate">{game.home.abbreviation}</span>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-semibold text-muted-foreground">{gameTime}</div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <div className="text-[9px] text-muted-foreground truncate">
          {game.pitchers.away.name} vs {game.pitchers.home.name}
        </div>
        {game.parkFactor !== 1.0 && (
          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${
            game.parkFactor > 1.05 ? "bg-red-500/10 text-red-400" : 
            game.parkFactor < 0.95 ? "bg-blue-500/10 text-blue-400" : "bg-muted text-muted-foreground"
          }`}>
            PF {game.parkFactor.toFixed(2)}
          </span>
        )}
      </div>
    </motion.button>
  );
}

function FactorRow({ factor }: { factor: FactorBreakdown }) {
  const barWidth = Math.abs(factor.advantageScore - 50) * 2;
  const isPositive = factor.advantageScore >= 50;
  
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-[110px] shrink-0">
        <span className="text-[10px] font-medium text-muted-foreground">{factor.label}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="relative h-3 rounded-full bg-muted/30 overflow-hidden">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/50" />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${barWidth}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`absolute inset-y-0 h-full rounded-full ${isPositive ? "left-1/2" : "right-1/2"}`}
            style={{ 
              background: isPositive 
                ? "linear-gradient(90deg, hsl(var(--chart-2)), hsl(var(--chart-2)/0.6))" 
                : "linear-gradient(270deg, hsl(var(--destructive)), hsl(var(--destructive)/0.6))",
              maxWidth: "50%",
            }}
          />
        </div>
      </div>
      <div className="w-10 text-right shrink-0">
        <span className={`text-[10px] font-bold tabular-nums ${
          factor.advantageScore >= 60 ? "text-green-400" :
          factor.advantageScore <= 40 ? "text-red-400" : "text-muted-foreground"
        }`}>
          {factor.advantageScore}
        </span>
      </div>
      <div className="w-6 text-right shrink-0">
        <span className="text-[8px] text-muted-foreground/60">{factor.weight}%</span>
      </div>
    </div>
  );
}

export default function MlbPredictionsPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [betType, setBetType] = useState("moneyline");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loadingPrediction, setLoadingPrediction] = useState(false);
  const [injuriesOpen, setInjuriesOpen] = useState(false);
  const [factorsOpen, setFactorsOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch games
  useEffect(() => {
    (async () => {
      setLoadingGames(true);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("mlb-model/games");
        if (fnErr) throw fnErr;
        setGames(data?.games || []);
      } catch (e: any) {
        console.error("Failed to fetch games:", e);
        setError("Failed to load today's games");
      } finally {
        setLoadingGames(false);
      }
    })();
  }, []);

  // Auto-select first game
  useEffect(() => {
    if (games.length > 0 && !selectedGame) setSelectedGame(games[0]);
  }, [games, selectedGame]);

  const analyze = useCallback(async () => {
    if (!selectedGame) return;
    setLoadingPrediction(true);
    setPrediction(null);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("mlb-model/analyze", {
        body: {
          game_id: selectedGame.id,
          bet_type: betType,
          team1_id: selectedGame.home.id,
          team2_id: selectedGame.away.id,
          over_under: betType === "total" ? "over" : undefined,
        },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setPrediction(data);
    } catch (e: any) {
      setError(e.message || "Analysis failed");
    } finally {
      setLoadingPrediction(false);
    }
  }, [selectedGame, betType]);

  // Re-analyze when game or bet type changes
  useEffect(() => {
    if (selectedGame) analyze();
  }, [selectedGame, betType, analyze]);

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <MobileHeader title="MLB Predictions" />

      <div className="w-full max-w-[430px] mx-auto px-4 pb-32 space-y-4">
        {/* Model Badge */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/10"
        >
          <Shield className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-bold text-primary tracking-wide">20-FACTOR MODEL</span>
          <span className="text-[9px] text-muted-foreground ml-auto">ESPN + Odds API</span>
        </motion.div>

        {/* Game Selector */}
        <div>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Today's Games</h2>
          {loadingGames ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : games.length === 0 ? (
            <div className="text-center py-8">
              <Target className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No MLB games scheduled today</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  isSelected={selectedGame?.id === game.id}
                  onClick={() => setSelectedGame(game)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bet Type Tabs */}
        {selectedGame && (
          <Tabs value={betType} onValueChange={setBetType} className="w-full">
            <TabsList className="w-full grid grid-cols-4 bg-muted/30 rounded-xl h-9">
              {BET_TYPES.map((bt) => (
                <TabsTrigger
                  key={bt.id}
                  value={bt.id}
                  className="text-[10px] font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg"
                >
                  {bt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* Loading State */}
        {loadingPrediction && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <div className="relative">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <Activity className="w-4 h-4 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-xs text-muted-foreground">Running 20-factor analysis...</p>
          </motion.div>
        )}

        {/* Error State */}
        {error && !loadingPrediction && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-center">
            <AlertTriangle className="w-5 h-5 text-destructive mx-auto mb-1" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {/* Prediction Results */}
        <AnimatePresence mode="wait">
          {prediction && !loadingPrediction && (
            <motion.div
              key={`${selectedGame?.id}-${betType}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              {/* Verdict Card */}
              <VerdictBadge
                confidence={prediction.confidence}
                verdict={prediction.verdict}
                overUnder={betType === "total" ? "over" : betType}
                line={0}
                propDisplay={`${selectedGame?.away.abbreviation} @ ${selectedGame?.home.abbreviation}`}
              />

              {/* Matchup Header */}
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  {selectedGame?.away.logo && <img src={selectedGame.away.logo} alt="" className="w-8 h-8" />}
                  <span className="text-sm font-bold text-foreground">{selectedGame?.away.abbreviation}</span>
                </div>
                <span className="text-xs text-muted-foreground font-medium">VS</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{selectedGame?.home.abbreviation}</span>
                  {selectedGame?.home.logo && <img src={selectedGame.home.logo} alt="" className="w-8 h-8" />}
                </div>
              </div>

              {/* Pitching Matchup */}
              <div className="rounded-2xl border border-border/30 bg-card/50 p-3">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Pitching Matchup</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: selectedGame?.away.abbreviation || "AWAY", p: prediction.pitchers?.away },
                    { label: selectedGame?.home.abbreviation || "HOME", p: prediction.pitchers?.home },
                  ].map((side) => (
                    <div key={side.label} className="space-y-1">
                      <div className="text-xs font-bold text-foreground">{side.p?.name || "TBD"}</div>
                      <div className="text-[9px] text-muted-foreground">{side.label}</div>
                      <div className="flex gap-2 mt-1">
                        {[
                          { l: "ERA", v: side.p?.era?.toFixed(2) },
                          { l: "WHIP", v: side.p?.whip?.toFixed(2) },
                          { l: "K/9", v: side.p?.k9?.toFixed(1) },
                        ].map((stat) => (
                          <div key={stat.l} className="text-center">
                            <div className="text-[10px] font-bold text-foreground tabular-nums">{stat.v || "—"}</div>
                            <div className="text-[7px] text-muted-foreground">{stat.l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Context Pills */}
              {prediction.context && (
                <div className="flex flex-wrap gap-1.5">
                  {prediction.context.weather && (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted/30 text-[9px] text-muted-foreground">
                        <Thermometer className="w-3 h-3" />
                        {prediction.context.weather.temp}°F
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted/30 text-[9px] text-muted-foreground">
                        <Wind className="w-3 h-3" />
                        {prediction.context.weather.windSpeed}mph {prediction.context.weather.windDir}
                      </span>
                    </>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted/30 text-[9px] text-muted-foreground">
                    <Target className="w-3 h-3" />
                    PF {prediction.context.parkFactor?.toFixed(2)}
                  </span>
                  {prediction.context.momentum && (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted/30 text-[9px] text-muted-foreground">
                        <TrendingUp className="w-3 h-3" />
                        {selectedGame?.away.abbreviation} L5: {prediction.context.momentum.team2?.join("")}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted/30 text-[9px] text-muted-foreground">
                        <TrendingUp className="w-3 h-3" />
                        {selectedGame?.home.abbreviation} L5: {prediction.context.momentum.team1?.join("")}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* AI Writeup */}
              {prediction.writeup && (
                <div className="rounded-2xl border border-primary/10 bg-primary/5 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-bold text-primary">AI ANALYSIS</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{prediction.writeup}</p>
                </div>
              )}

              {/* 20-Factor Breakdown */}
              <Collapsible open={factorsOpen} onOpenChange={setFactorsOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      20-Factor Breakdown
                    </span>
                  </div>
                  {factorsOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-2xl border border-border/30 bg-card/50 p-3">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-[8px] text-muted-foreground">FACTOR</span>
                      <div className="flex gap-6">
                        <span className="text-[8px] text-red-400">← {selectedGame?.away.abbreviation}</span>
                        <span className="text-[8px] text-green-400">{selectedGame?.home.abbreviation} →</span>
                      </div>
                    </div>
                    {prediction.factorBreakdown
                      .sort((a, b) => b.weight - a.weight)
                      .map((factor) => (
                        <FactorRow key={factor.factor} factor={factor} />
                      ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Injury Report */}
              {(prediction.injuries.warnings.length > 0 || prediction.injuries.team1.length > 0 || prediction.injuries.team2.length > 0) && (
                <Collapsible open={injuriesOpen} onOpenChange={setInjuriesOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full py-2">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        Injury Report
                      </span>
                      {prediction.injuries.warnings.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-[8px] font-bold text-yellow-500">
                          {prediction.injuries.warnings.length}
                        </span>
                      )}
                    </div>
                    {injuriesOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="rounded-2xl border border-border/30 bg-card/50 p-3 space-y-2">
                      {prediction.injuries.warnings.map((w, i) => (
                        <div key={i} className="text-[10px] text-yellow-400 flex items-start gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                      {prediction.injuries.warnings.length === 0 && (
                        <p className="text-[10px] text-muted-foreground text-center py-2">No key injuries affecting this matchup</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
