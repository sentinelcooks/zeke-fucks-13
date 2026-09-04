import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Brain,
  Check,
  CircleAlert,
  Clock3,
  Loader2,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import WrittenAnalysis, { type Decision as WrittenAnalysisDecision } from "@/components/WrittenAnalysis";
import { formatOdds } from "@/utils/oddsFormat";
import {
  analysisNarrative,
  gameModelMetric,
  headToHeadRows,
  type GameAnalysisResponse,
} from "@/lib/gameAnalysisPresentation";

export type GameAnalysisMarketKey = "h2h" | "spreads" | "totals";

export interface GameAnalysisQuote {
  side: "home" | "away" | "over" | "under";
  label: string;
  price: number;
  point?: number;
}

export interface GameAnalysisReportEntry {
  label: string;
  quote?: GameAnalysisQuote;
  response?: GameAnalysisResponse;
  error?: string;
}

export interface GameAnalysisReportMarket {
  key: GameAnalysisMarketKey;
  title: string;
  state: "complete" | "unavailable" | "error";
  message: string;
  entries: GameAnalysisReportEntry[];
}

export interface GameAnalysisReportSelection {
  marketKey: GameAnalysisMarketKey;
  marketTitle: string;
  label: string;
  quote?: GameAnalysisQuote;
  response: GameAnalysisResponse;
}

export interface GameAnalysisReport {
  event: {
    id: string;
    sportTitle: string;
    commenceTime: string;
    homeTeam: string;
    awayTeam: string;
  };
  scope: "full" | GameAnalysisMarketKey;
  markets: GameAnalysisReportMarket[];
  selected?: GameAnalysisReportSelection;
  message: string;
}

export type GameAnalysisExperienceState =
  | { stage: "scanning"; event: GameAnalysisReport["event"]; scope: GameAnalysisReport["scope"] }
  | { stage: "report"; report: GameAnalysisReport };

interface GameAnalysisExperienceProps {
  experience: GameAnalysisExperienceState | null;
  onClose: () => void;
}

const FULL_GAME_STEPS = [
  "Verifying scheduled event",
  "Reading published live markets",
  "Running Sentinel market models",
  "Preparing the evidence report",
];

function marketScopeLabel(scope: GameAnalysisReport["scope"]) {
  if (scope === "full") return "Full game";
  if (scope === "h2h") return "Moneyline";
  if (scope === "spreads") return "Spread";
  return "Game total";
}

function writtenAnalysisDecision(response: GameAnalysisResponse | undefined): WrittenAnalysisDecision | null {
  const decision = response?.decision;
  if (!decision) return null;

  const convictionTier: WrittenAnalysisDecision["conviction_tier"] =
    decision.conviction_tier === "low" || decision.conviction_tier === "medium" || decision.conviction_tier === "high" || decision.conviction_tier === "veryHigh"
      ? decision.conviction_tier
      : "noBet";
  const recommendedUnits: WrittenAnalysisDecision["recommended_units"] =
    decision.recommended_units === 0.5 || decision.recommended_units === 1 || decision.recommended_units === 2 || decision.recommended_units === 3
      ? decision.recommended_units
      : 0;
  const probability = Number(decision.win_probability);

  return {
    winning_side: decision.winning_side || null,
    winning_team_name: decision.winning_team_name || null,
    win_probability: Number.isFinite(probability) ? probability : 0,
    edge: null,
    conviction_tier: convictionTier,
    recommended_units: recommendedUnits,
    verdict_text: response.verdict || "No bet",
    grade_explanation: decision.grade_explanation || undefined,
  };
}

function GameAnalysisScan({ event, scope }: Extract<GameAnalysisExperienceState, { stage: "scanning" }>) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((current) => Math.min(current + 1, FULL_GAME_STEPS.length - 1));
    }, 1_050);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <motion.div
      key="game-analysis-scan"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] overflow-hidden bg-[#07070b] text-foreground"
    >
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 18%, hsla(250, 76%, 62%, 0.20), transparent 34%), linear-gradient(180deg, #100c1d 0%, #07070b 72%)" }} />
      <div className="absolute inset-x-0 top-[19%] h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
      <motion.div
        className="absolute left-[8%] right-[8%] h-[3px] rounded-full"
        style={{ background: "linear-gradient(90deg, transparent, hsl(158 64% 52%), hsl(250 92% 76%), hsl(158 64% 52%), transparent)", boxShadow: "0 0 30px hsla(158,64%,52%,0.85)" }}
        animate={{ top: ["20%", "75%", "20%"] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col px-6 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
          <ScanLine className="h-3.5 w-3.5" /> Sentinel analysis
        </div>

        <div className="flex flex-1 flex-col items-center justify-center pb-8 text-center">
          <div className="relative mb-8 grid h-40 w-40 place-items-center">
            <motion.div className="absolute inset-0 rounded-full border border-accent/30" animate={{ scale: [0.92, 1.08, 0.92], opacity: [0.35, 0.85, 0.35] }} transition={{ duration: 2.2, repeat: Infinity }} />
            <motion.div className="absolute inset-4 rounded-full border border-nba-green/25" animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }} />
            <div className="relative grid h-20 w-20 place-items-center rounded-[28px] border border-accent/35 bg-accent/10 shadow-[0_0_38px_hsla(250,76%,62%,0.28)]">
              <Target className="h-9 w-9 text-nba-green" />
            </div>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/65">{event.sportTitle}</p>
          <h1 className="mt-2 text-xl font-black tracking-tight text-foreground">{event.awayTeam} <span className="text-accent">vs</span> {event.homeTeam}</h1>
          <p className="mt-3 text-sm font-semibold text-foreground/82">Scanning {marketScopeLabel(scope).toLowerCase()} evidence</p>
          <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-muted-foreground/65">Sentinel is verifying the event, live prices, and model inputs before it shows a result.</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-black/25 p-4 backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-accent/85">Building your report</span>
            <span className="flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground/55"><Clock3 className="h-3 w-3" /> Live check</span>
          </div>
          <div className="space-y-3">
            {FULL_GAME_STEPS.map((step, index) => {
              const complete = index < activeStep;
              const current = index === activeStep;
              return (
                <div key={step} className="flex items-center gap-3 text-left">
                  <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${complete ? "border-nba-green/40 bg-nba-green/15 text-nba-green" : current ? "border-accent/50 bg-accent/15 text-accent" : "border-white/10 text-muted-foreground/35"}`}>
                    {complete ? <Check className="h-3 w-3" /> : current ? <Loader2 className="h-3 w-3 animate-spin" /> : index + 1}
                  </span>
                  <span className={`text-[11px] ${complete || current ? "font-semibold text-foreground/85" : "text-muted-foreground/40"}`}>{step}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ReportMarketStatus({ market, selected }: { market: GameAnalysisReportMarket; selected?: GameAnalysisReportSelection }) {
  const isSelected = selected?.marketKey === market.key;
  const completed = market.state === "complete";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: isSelected ? "hsla(250,76%,62%,0.12)" : "hsla(228,20%,10%,0.56)", border: `1px solid ${isSelected ? "hsla(250,76%,62%,0.30)" : "hsla(228,30%,20%,0.34)"}` }}>
      <div className="min-w-0"><p className="text-[11px] font-bold text-foreground/90">{market.title}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground/60">{isSelected ? selected.label : completed ? "Model reviewed" : "No verified response"}</p></div>
      <span className={`shrink-0 text-[8px] font-bold uppercase tracking-wider ${completed ? "text-nba-green" : "text-muted-foreground/50"}`}>{completed ? "Checked" : "Unavailable"}</span>
    </div>
  );
}

function GameAnalysisReportView({ report, onClose }: { report: GameAnalysisReport; onClose: () => void }) {
  const selected = report.selected;
  const response = selected?.response;
  const metric = gameModelMetric(response);
  const team1Name = response?.team1?.name || report.event.awayTeam;
  const team2Name = response?.team2?.name || report.event.homeTeam;
  const h2hRows = headToHeadRows(response, team1Name, team2Name);
  const narrative = analysisNarrative(response);
  const factors = [...(response?.factorBreakdown || [])]
    .filter((factor) => (factor.label || factor.name) && Number(factor.weight ?? 0) > 0)
    .sort((first, second) => Number(second.weight ?? 0) - Number(first.weight ?? 0))
    .slice(0, 5);
  const isNoBet = response?.decision?.conviction_tier === "noBet" || !response?.decision?.recommended_units;

  return (
    <motion.div key="game-analysis-report" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} className="fixed inset-0 z-[80] overflow-y-auto bg-[#08070d] text-foreground">
      <div className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#08070d]/90 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-foreground transition-colors hover:bg-white/[0.08]" aria-label="Back to game lines"><ArrowLeft className="h-4 w-4" /></button>
          <div className="text-center"><p className="text-[8px] font-bold uppercase tracking-[0.16em] text-accent">Sentinel report</p><p className="mt-0.5 text-[11px] font-bold text-foreground">{marketScopeLabel(report.scope)} analysis</p></div>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-nba-green/10 text-nba-green"><ShieldCheck className="h-4 w-4" /></div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md space-y-4 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5">
        <section className="overflow-hidden rounded-3xl border border-accent/20 p-5" style={{ background: "radial-gradient(circle at 85% 0%, hsla(250,76%,62%,0.26), transparent 42%), linear-gradient(145deg, hsla(245,34%,15%,0.96), hsla(228,25%,8%,0.96))" }}>
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-nba-green">Verified matchup</p>
          <h1 className="mt-2 text-lg font-black tracking-tight text-foreground">{report.event.awayTeam} <span className="text-accent">at</span> {report.event.homeTeam}</h1>
          {selected ? (
            <div className="mt-5 flex items-center gap-5">
              <div className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full border border-accent/35 bg-black/20">
                <div className="absolute inset-2 rounded-full border border-nba-green/25" />
                <div className="relative text-center"><p className="text-2xl font-black tabular-nums text-foreground">{metric.display}</p><p className="mt-1 text-[7px] font-bold uppercase tracking-wider text-muted-foreground/65">{metric.label}</p></div>
              </div>
              <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">Strongest model signal</p><p className="mt-1 text-base font-black text-foreground">{selected.marketTitle}</p><p className="mt-1 truncate text-[13px] font-semibold text-nba-green">{selected.label}{selected.quote?.point != null ? ` ${selected.quote.point > 0 ? "+" : ""}${selected.quote.point}` : ""}</p><p className="mt-1.5 text-[10px] text-muted-foreground/65">Live price {selected.quote ? formatOdds(selected.quote.price) : "not returned"}</p></div>
            </div>
          ) : (
            <div className="mt-5 flex gap-3 rounded-2xl border border-white/[0.08] bg-black/20 p-4"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><p className="text-sm font-bold text-foreground">Analysis unavailable</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">{report.message}</p></div></div>
          )}
          {selected && <p className={`mt-4 text-[10px] leading-relaxed ${metric.isProbability && !isNoBet ? "text-nba-green" : "text-muted-foreground/70"}`}>{metric.isProbability && !isNoBet ? "This price has a calibrated model-supported edge." : "This is a directional model signal only. It is not a calibrated betting recommendation."}</p>}
        </section>

        <section className="space-y-2"><div className="flex items-center gap-2 px-1"><BarChart3 className="h-3.5 w-3.5 text-accent" /><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/78">Markets checked</h2></div><div className="grid gap-2">{report.markets.map((market) => <ReportMarketStatus key={market.key} market={market} selected={selected} />)}</div></section>

        {selected && <>
          <section className="vision-card overflow-hidden p-4" style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
            <div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-nba-green" /><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/80">Model context</h2></div>
            <p className="mt-3 text-[12px] leading-relaxed text-foreground/75">{narrative || "Sentinel completed the model check using the verified matchup and available live market."}</p>
          </section>

          <section className="vision-card p-4" style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
            <div className="flex items-center gap-2"><Target className="h-3.5 w-3.5 text-accent" /><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/80">Past meetings</h2></div>
            {h2hRows.length > 0 ? <div className="mt-3 space-y-2">{h2hRows.map((row) => <div key={row.id} className="rounded-xl bg-black/20 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold text-foreground/85">{row.scoreLabel}</p><p className="shrink-0 text-[8px] font-semibold text-nba-green">{row.outcomeLabel}</p></div><p className="mt-1 text-[9px] text-muted-foreground/55">{row.dateLabel}{row.venue ? ` · ${row.venue}` : ""}</p></div>)}</div> : <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/65">No completed head-to-head meetings were returned for this matchup.</p>}
          </section>

          {factors.length > 0 && <section className="vision-card p-4" style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
            <div className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-accent" /><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/80">Key model factors</h2></div>
            <div className="mt-3 space-y-2">{factors.map((factor, index) => <div key={`${factor.label || factor.name}-${index}`} className="rounded-xl bg-black/20 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="text-[11px] font-bold text-foreground/85">{factor.label || factor.name}</p>{Number.isFinite(Number(factor.score)) && <p className="text-[10px] font-black tabular-nums text-accent">{Math.round(Number(factor.score))}/100</p>}</div>{factor.detail && <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/60">{factor.detail}</p>}</div>)}</div>
          </section>}

          <WrittenAnalysis
            type="moneyline"
            verdict={response?.verdict || "NO BET"}
            confidence={metric.value || 0}
            playerOrTeam={selected.label}
            propDisplay={selected.marketTitle}
            overUnder={selected.quote?.side === "over" || selected.quote?.side === "under" ? selected.quote.side : undefined}
            reasoning={response?.factors}
            factors={factors.map((factor) => factor.detail || factor.label || factor.name || "").filter(Boolean)}
            factorBreakdown={factors.map((factor) => ({ name: factor.label || factor.name || "Model factor", team1Score: factor.team1Score, team2Score: factor.team2Score, weight: factor.weight }))}
            decision={writtenAnalysisDecision(response)}
            team1Name={team1Name}
            team2Name={team2Name}
            sport={report.event.sportTitle.toLowerCase()}
            scoreKind={response?.score_kind}
            probabilitySupported={response?.probability_supported === true}
          />
        </>}
      </main>
    </motion.div>
  );
}

export function GameAnalysisExperience({ experience, onClose }: GameAnalysisExperienceProps) {
  return <AnimatePresence>{experience?.stage === "scanning" && <GameAnalysisScan {...experience} />}{experience?.stage === "report" && <GameAnalysisReportView report={experience.report} onClose={onClose} />}</AnimatePresence>;
}
