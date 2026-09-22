import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Layers,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import WrittenAnalysis, { type Decision as WrittenAnalysisDecision } from "@/components/WrittenAnalysis";
import { getTeamLogoUrl, resolveLogoSport } from "@/utils/teamLogos";
import { useParlaySlip, type ParlaySlipLeg } from "@/contexts/ParlaySlipContext";
import { tierForScore } from "@/lib/gameAnalysisTiers";
import {
  analysisNarrative,
  gameModelMetric,
  headToHeadRows,
  quoteSelectionLabel,
  type GameAnalysisResponse,
} from "@/lib/gameAnalysisPresentation";
import { MatchupCard } from "./MatchupCard";
import { ModelSignalCard } from "./ModelSignalCard";
import { ModelStatTiles } from "./ModelStatTiles";
import { RunProjectionCard } from "./RunProjectionCard";
import { TeamComparisonCard } from "./TeamComparisonCard";
import { ConditionsCard } from "./ConditionsCard";
import { OddsTabsCard } from "./OddsTabsCard";
import { DataCheckCard } from "./DataCheckCard";
import { PastMeetingsCard } from "./PastMeetingsCard";
import { HowToReadCard } from "./HowToReadCard";

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

/**
 * Real facts about the run, shown on the scan screen.
 *
 * The step list is driven from these rather than from a timer, so a step only
 * ever reads as done once it actually is: the event and markets are verified
 * before the scan opens, and `phase` flips to "report" only when every model
 * call has returned.
 */
export interface GameAnalysisScanDetails {
  awayShortName?: string | null;
  homeShortName?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  /** Live markets the book has posted for this game. */
  marketsAvailable?: number;
  phase?: "models" | "report";
}

export type GameAnalysisExperienceState =
  | { stage: "scanning"; event: GameAnalysisReport["event"]; scope: GameAnalysisReport["scope"]; details?: GameAnalysisScanDetails }
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

/** "Today", "Tomorrow", or the weekday, relative to the viewer's local day. */
function relativeDay(iso: string): string {
  const start = new Date(iso);
  if (!Number.isFinite(start.getTime())) return "";
  const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((midnight(start) - midnight(new Date())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(start);
}

/** Last word of a club name, for when no short name was resolved. */
function fallbackNickname(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  return words.length > 1 ? words[words.length - 1] : fullName;
}

/**
 * One team in the scan header: its real logo on a raised tile.
 *
 * Falls back to the abbreviation, then initials, so the tile is never empty
 * when a crest can't be resolved.
 */
function ScanTeamTile({ name, abbr, sportTitle, side, delay }: {
  name: string;
  abbr?: string | null;
  sportTitle: string;
  side: "Away" | "Home";
  delay: number;
}) {
  const [failed, setFailed] = useState(false);
  const reduceMotion = useReducedMotion();
  const sport = resolveLogoSport(sportTitle);
  const logo = sport ? getTeamLogoUrl(name, sport, 160) : "";
  const fallback = (abbr || name.split(/\s+/).map((word) => word[0]).join("").slice(0, 3)).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        className="grid h-[76px] w-[76px] place-items-center rounded-[22px] p-3"
        style={{
          background: "linear-gradient(150deg, hsla(228,30%,19%,0.96), hsla(228,32%,9%,0.96))",
          border: "1px solid hsla(228,30%,28%,0.55)",
          boxShadow: "0 10px 28px -10px hsla(250,76%,62%,0.45)",
        }}
        animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, delay, ease: "easeInOut" }}
      >
        {logo && !failed ? (
          <img src={logo} alt={`${name} logo`} className="h-full w-full object-contain drop-shadow-md" loading="eager" onError={() => setFailed(true)} />
        ) : (
          <span className="text-[17px] font-black tracking-tight text-foreground">{fallback}</span>
        )}
      </motion.div>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/55">{side}</span>
    </div>
  );
}

/** Concentric rings with a rotating sweep and "VS" at the centre. */
function ScanRadar() {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative grid h-[150px] w-[150px] shrink-0 place-items-center">
      {[150, 104, 58].map((size) => (
        <span
          key={size}
          className="absolute rounded-full"
          style={{ width: size, height: size, border: "1px solid hsla(228,30%,40%,0.28)" }}
        />
      ))}
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ background: "conic-gradient(from 0deg, hsla(158,64%,52%,0.32), hsla(158,64%,52%,0) 70deg, transparent 360deg)" }}
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
      >
        {/* The sweep's leading edge. */}
        <span className="absolute left-1/2 top-1/2 h-[2px] w-1/2 origin-left rounded-full" style={{ background: "hsl(158 64% 52%)", boxShadow: "0 0 10px hsl(158 64% 52%)" }} />
      </motion.span>
      <span
        className="relative grid h-[52px] w-[52px] place-items-center rounded-full text-[13px] font-black tracking-wider text-nba-green"
        style={{ background: "hsla(158,64%,52%,0.08)", border: "1px solid hsla(158,64%,52%,0.35)" }}
      >
        VS
      </span>
    </div>
  );
}

function GameAnalysisScan({ event, scope, details, onCancel }: Extract<GameAnalysisExperienceState, { stage: "scanning" }> & { onCancel: () => void }) {
  // The first two steps are facts established before the scan opened — the
  // event was matched and the markets were read. They are revealed one after
  // the other so the list reads as progress, but never ahead of the truth:
  // step 3 stays "Running" until every model call has actually returned.
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    const first = window.setTimeout(() => setRevealed(1), 450);
    const second = window.setTimeout(() => setRevealed(2), 950);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, []);

  const modelsDone = details?.phase === "report";
  const activeStep = revealed < 2 ? revealed : modelsDone ? 3 : 2;

  const awayName = details?.awayShortName || fallbackNickname(event.awayTeam);
  const homeName = details?.homeShortName || fallbackNickname(event.homeTeam);
  const markets = details?.marketsAvailable;
  const kickoff = new Date(event.commenceTime);
  const kickoffLabel = Number.isFinite(kickoff.getTime())
    ? `${relativeDay(event.commenceTime)} ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(kickoff)}`
    : "";
  const todayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date());

  const stepStatus = (index: number): string => {
    if (index === 0) return "Confirmed";
    if (index === 1) return typeof markets === "number" ? `${markets} market${markets === 1 ? "" : "s"}` : "Checked";
    if (index === 2) return index < activeStep ? "Done" : "Running";
    return "Preparing";
  };

  return (
    <motion.div
      key="game-analysis-scan"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[45] overflow-y-auto bg-[#07070b] text-foreground"
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 22%, hsla(250,76%,62%,0.16), transparent 38%), linear-gradient(180deg, #0d0b18 0%, #07070b 70%)" }} />

      <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel analysis"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-foreground transition-colors hover:bg-white/[0.08]"
            style={{ background: "hsla(228,24%,14%,0.9)", border: "1px solid hsla(228,30%,24%,0.6)" }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-black uppercase tracking-[0.04em] text-foreground">Sentinel analysis</p>
            <p className="text-[10px] text-muted-foreground/60">{scope === "full" ? "Game lines" : marketScopeLabel(scope)} · {todayLabel}</p>
          </div>
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold tracking-[0.12em] text-nba-green"
            style={{ background: "hsla(158,64%,52%,0.1)", border: "1px solid hsla(158,64%,52%,0.3)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-nba-green" style={{ boxShadow: "0 0 6px hsl(158 64% 52%)" }} />
            LIVE
          </span>
        </header>

        <div className="mt-7 flex items-center justify-center gap-3">
          <ScanTeamTile name={event.awayTeam} abbr={details?.awayAbbr} sportTitle={event.sportTitle} side="Away" delay={0} />
          <ScanRadar />
          <ScanTeamTile name={event.homeTeam} abbr={details?.homeAbbr} sportTitle={event.sportTitle} side="Home" delay={0.35} />
        </div>

        <div className="mt-6 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-nba-green">
            {event.sportTitle}{kickoffLabel ? ` · ${kickoffLabel}` : ""}
          </p>
          <h1 className="mt-1.5 text-[26px] font-black tracking-tight text-foreground">
            {awayName} <span className="text-nba-green">@</span> {homeName}
          </h1>
          <p className="mx-auto mt-2 max-w-[17rem] text-[12px] leading-relaxed text-muted-foreground/70">
            Verifying the event, live prices and model inputs before showing a result.
          </p>
        </div>

        <section className="vision-card mt-6 p-4" style={{ borderColor: "hsla(228,30%,22%,0.45)" }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-nba-green">Building your report</span>
            <span className="text-[10px] font-semibold text-muted-foreground/65">Step {activeStep + 1} of {FULL_GAME_STEPS.length}</span>
          </div>

          <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${FULL_GAME_STEPS.length}, minmax(0, 1fr))` }}>
            {FULL_GAME_STEPS.map((step, index) => (
              <span
                key={step}
                className="h-1 rounded-full transition-colors duration-500"
                style={{ background: index <= activeStep ? "hsl(158 64% 52%)" : "hsla(228,24%,22%,0.9)" }}
              />
            ))}
          </div>

          <div className="mt-3.5 space-y-1.5">
            {FULL_GAME_STEPS.map((step, index) => {
              const complete = index < activeStep;
              const current = index === activeStep;
              return (
                <div
                  key={step}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors"
                  style={current
                    ? { background: "hsla(158,64%,52%,0.07)", border: "1px solid hsla(158,64%,52%,0.4)" }
                    : { border: "1px solid transparent" }}
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                    style={complete
                      ? { background: "hsla(158,64%,52%,0.14)", border: "1px solid hsla(158,64%,52%,0.4)", color: "hsl(158 64% 52%)" }
                      : current
                        ? { border: "2px solid hsla(158,64%,52%,0.25)" }
                        : { border: "1px solid hsla(228,30%,30%,0.6)", color: "hsla(228,15%,60%,0.5)" }}
                  >
                    {complete ? <Check className="h-3 w-3" strokeWidth={3} /> : current ? <Loader2 className="h-3.5 w-3.5 animate-spin text-nba-green" /> : index + 1}
                  </span>
                  <span className={`min-w-0 flex-1 text-[12.5px] ${complete || current ? "font-semibold text-foreground/90" : "text-muted-foreground/45"}`}>
                    {step}
                  </span>
                  {(complete || current) && (
                    <span className={`shrink-0 text-[10.5px] font-semibold ${current ? "text-nba-green" : "text-muted-foreground/60"}`}>
                      {stepStatus(index)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-2xl py-3.5 text-[13px] font-bold text-foreground/85 transition-colors hover:text-foreground"
          style={{ background: "transparent", border: "1px solid hsla(228,30%,26%,0.6)" }}
        >
          Cancel analysis
        </button>
      </div>
    </motion.div>
  );
}
/**
 * What a score is counted in for this sport, so baseball reads "runs" and
 * basketball reads "points" instead of every sport borrowing baseball's word.
 */
function scoringUnits(sportTitle: string): { unit: string; projectionTitle: string } {
  const value = String(sportTitle ?? "").toLowerCase();
  if (value.includes("mlb") || value.includes("baseball")) return { unit: "runs", projectionTitle: "Run projection" };
  if (value.includes("nhl") || value.includes("hockey")) return { unit: "goals", projectionTitle: "Goal projection" };
  return { unit: "points", projectionTitle: "Score projection" };
}

/** Maps the sport title onto the parlay slip's sport union, or null if unsupported. */
function slipSport(sportTitle: string): ParlaySlipLeg["sport"] | null {
  const value = String(sportTitle ?? "").toLowerCase();
  if (value.includes("mlb") || value.includes("baseball")) return "MLB";
  if (value.includes("nhl") || value.includes("hockey")) return "NHL";
  // WNBA is deliberately absent: the slip's sport union has no entry for it,
  // and filing a WNBA leg under "NBA" would mislabel it everywhere downstream.
  if (value.includes("nba") && !value.includes("wnba")) return "NBA";
  return null;
}

/**
 * "Over 8.0", "Guardians -1.5", or just the team name for a moneyline.
 *
 * A total's number is a threshold, not a handicap, so it carries no sign — an
 * "Over +8" reads as if the line were plus-eight runs. Spreads keep their sign,
 * because there the sign is the whole meaning.
 */
function pickLabelFor(selection: GameAnalysisReportSelection): string {
  return quoteSelectionLabel(selection.label, selection.quote?.point, selection.quote?.side);
}

function AddToParlayButton({
  selection,
  sportTitle,
  actionable,
}: {
  selection: GameAnalysisReportSelection;
  sportTitle: string;
  actionable: boolean;
}) {
  const slip = useParlaySlip();
  const sport = slipSport(sportTitle);
  const quote = selection.quote;
  if (!sport || !quote) return null;

  const label = pickLabelFor(selection);
  const lineKey = quote.point != null && Number.isFinite(quote.point) ? String(quote.point) : "";
  const inSlip = slip.isInSlip(label, selection.marketTitle, lineKey);

  const toggle = () => {
    if (inSlip) {
      const existing = slip.legs.find(
        (leg) => leg.player === label && leg.propType === selection.marketTitle && leg.line === lineKey,
      );
      if (existing) slip.removeLeg(existing.id);
      return;
    }
    slip.addLeg({
      sport,
      player: label,
      propType: selection.marketTitle,
      line: lineKey,
      overUnder: quote.side === "under" ? "under" : "over",
      odds: quote.price,
    });
  };

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.97 }}
      onClick={toggle}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[13px] font-bold tracking-[0.14em] transition-all ${
        inSlip || !actionable ? "text-muted-foreground" : "text-white"
      }`}
      style={
        inSlip
          ? { background: "hsla(250,76%,62%,0.08)", border: "1px solid hsla(250,76%,62%,0.3)" }
          : actionable
            ? { background: "linear-gradient(135deg, hsla(250,76%,62%,0.7), hsla(210,100%,60%,0.7))" }
            // A model that is not leaning hard enough to act on gets the muted
            // outline, so the button's weight matches the signal behind it.
            : { background: "transparent", border: "1px solid hsla(228,30%,22%,0.5)" }
      }
    >
      {inSlip ? <X className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
      {inSlip ? "REMOVE FROM PARLAY" : "ADD TO PARLAY"}
    </motion.button>
  );
}

/**
 * Adapts the model's decision onto the contract `WrittenAnalysis` expects.
 *
 * The tier and unit fields are narrowed rather than cast: anything outside the
 * known set becomes "noBet" / 0, so an unexpected value from the model can
 * never be read downstream as a staking recommendation.
 */
function writtenAnalysisDecision(response: GameAnalysisResponse | undefined): WrittenAnalysisDecision | null {
  const decision = response?.decision;
  if (!decision) return null;

  const convictionTier: WrittenAnalysisDecision["conviction_tier"] =
    decision.conviction_tier === "low" || decision.conviction_tier === "medium" ||
    decision.conviction_tier === "high" || decision.conviction_tier === "veryHigh"
      ? decision.conviction_tier
      : "noBet";
  const recommendedUnits: WrittenAnalysisDecision["recommended_units"] =
    decision.recommended_units === 0.5 || decision.recommended_units === 1 ||
    decision.recommended_units === 2 || decision.recommended_units === 3
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
    verdict_text: response?.verdict || "No bet",
    grade_explanation: decision.grade_explanation || undefined,
  };
}

function GameAnalysisReportView({ report, onClose }: { report: GameAnalysisReport; onClose: () => void }) {
  const selected = report.selected;
  const response = selected?.response;
  const metric = gameModelMetric(response);
  const tier = tierForScore(metric.value);

  const awayTeam = report.event.awayTeam;
  const homeTeam = report.event.homeTeam;
  const h2hRows = headToHeadRows(response, response?.team1?.name || awayTeam, response?.team2?.name || homeTeam);
  const narrative = analysisNarrative(response);
  const context = response?.context ?? null;

  // Factors that carry weight AND state a direction. A factor sitting at
  // exactly 50 is dead even: it counts in the model's maths but says nothing,
  // and leading a written analysis with "0 vs 0" reads as broken.
  const factors = [...(response?.factorBreakdown || [])]
    .filter((factor) =>
      (factor.label || factor.name) &&
      Number(factor.weight ?? 0) > 0 &&
      Number(factor.team1Score ?? 50) !== 50)
    .sort((first, second) => Number(second.weight ?? 0) - Number(first.weight ?? 0))
    .slice(0, 10);

  // The projected game total is only comparable to a TOTAL line. The WNBA model
  // returns `predicted_total` on every market, so reading it unconditionally
  // plotted a 184-point game total against a 12.5 spread ("Gap +171.5").
  // Gating on the market keeps the gauge, projection card and model/gap tiles
  // to the one case where the two numbers share a scale.
  const isTotalMarket = selected?.marketKey === "totals";
  const lineValue = selected?.quote?.point ?? null;
  const projection = isTotalMarket ? response?.predicted_total ?? null : null;
  const scoring = scoringUnits(report.event.sportTitle);
  const unit = isTotalMarket ? scoring.unit : undefined;

  const analysedAt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
  const season = report.event.commenceTime
    ? String(new Date(report.event.commenceTime).getFullYear())
    : undefined;

  return (
    <motion.div key="game-analysis-report" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} className="fixed inset-0 z-[45] overflow-y-auto bg-[#08070d] text-foreground">
      <div className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#08070d]/90 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-foreground transition-colors hover:bg-white/[0.08]" aria-label="Back to game lines"><ArrowLeft className="h-4 w-4" /></button>
          <div className="text-center"><p className="text-[8px] font-bold uppercase tracking-[0.16em] text-accent">Sentinel report</p><p className="mt-0.5 text-[11px] font-bold text-foreground">{marketScopeLabel(report.scope)} analysis</p></div>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-nba-green/10 text-nba-green"><ShieldCheck className="h-4 w-4" /></div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md space-y-3 px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4">
        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-2 font-bold uppercase tracking-[0.12em] text-nba-green">
            <span className="h-[7px] w-[7px] rounded-full bg-nba-green" style={{ boxShadow: "0 0 8px hsl(158 64% 52%)" }} />
            Analysis complete
          </span>
          <span>{analysedAt}</span>
        </div>

        <MatchupCard
          awayTeam={awayTeam}
          homeTeam={homeTeam}
          sportTitle={report.event.sportTitle}
          commenceTime={report.event.commenceTime}
          venue={response?.matchup?.venue}
          status={response?.matchup?.status}
          context={context}
        />

        {selected ? (
          <>
            <ModelSignalCard
              score={metric.value}
              marketTitle={selected.marketTitle}
              pickLabel={pickLabelFor(selected)}
              price={selected.quote?.price ?? null}
              projection={projection}
              line={lineValue}
              unit={scoring.unit}
            />

            <AddToParlayButton selection={selected} sportTitle={report.event.sportTitle} actionable={tier.actionable} />

            <ModelStatTiles projection={projection} line={lineValue} coverage={response?.data_coverage} unit={unit} />

            <RunProjectionCard projection={projection} line={lineValue} unit={scoring.unit} title={scoring.projectionTitle} />

            <TeamComparisonCard
              awayTeam={awayTeam}
              homeTeam={homeTeam}
              awayStats={context?.awayTeamStats}
              homeStats={context?.homeTeamStats}
            />

            <ConditionsCard context={context} />

            <OddsTabsCard markets={report.markets} selected={selected} tierColor={tier.color} />

            <DataCheckCard
              missingInputs={response?.missing_inputs}
              feedMissing={response?.feed_missing}
              coverage={response?.data_coverage}
            />

            <PastMeetingsCard rows={h2hRows} season={season} />

            <WrittenAnalysis
              type="moneyline"
              verdict={response?.verdict || "NO BET"}
              confidence={metric.value || 0}
              playerOrTeam={pickLabelFor(selected)}
              propDisplay={selected.marketTitle}
              overUnder={selected.quote?.side === "over" || selected.quote?.side === "under" ? selected.quote.side : undefined}
              reasoning={response?.factors}
              factors={factors.map((factor) => factor.detail || factor.label || factor.name || "").filter(Boolean)}
              factorBreakdown={factors.map((factor) => ({
                name: factor.label || factor.name || "Model factor",
                team1Score: factor.team1Score,
                team2Score: factor.team2Score,
                weight: factor.weight,
                detail: factor.detail,
              }))}
              projection={projection}
              lineValue={lineValue}
              unit={scoring.unit}
              factorCount={response?.factorBreakdown?.length ?? factors.length}
              coverage={response?.data_coverage ?? null}
              missingInputs={response?.missing_inputs}
              decision={writtenAnalysisDecision(response)}
              team1Name={response?.team1?.name || awayTeam}
              team2Name={response?.team2?.name || homeTeam}
              sport={report.event.sportTitle.toLowerCase()}
              scoreKind={response?.score_kind}
              probabilitySupported={response?.probability_supported === true}
            />

            <HowToReadCard narrative={narrative} />
          </>
        ) : (
          <>
            <section className="vision-card flex gap-3 p-4" style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-bold text-foreground">Analysis unavailable</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">{report.message}</p>
              </div>
            </section>
            <OddsTabsCard markets={report.markets} tierColor={tier.color} />
          </>
        )}
      </main>
    </motion.div>
  );
}

/**
 * Rendered through a portal at the document root, on purpose.
 *
 * The Analyze page wraps this in a `relative z-10` container, which creates a
 * stacking context: any z-index inside it is capped at 10, so the app's sticky
 * header (z-40) and bottom tab bar (z-50) were drawn OVER the scan and report,
 * hiding their back button and title. At the root, z-[45] puts both screens
 * above the header while leaving the tab bar visible underneath, as in the
 * design; each screen pads its bottom to clear it.
 */
export function GameAnalysisExperience({ experience, onClose }: GameAnalysisExperienceProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<AnimatePresence>{experience?.stage === "scanning" && <GameAnalysisScan {...experience} onCancel={onClose} />}{experience?.stage === "report" && <GameAnalysisReportView report={experience.report} onClose={onClose} />}</AnimatePresence>, document.body);
}
