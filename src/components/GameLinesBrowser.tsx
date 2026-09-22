import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTeamLogoUrl, listNflTeams } from "@/utils/teamLogos";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Loader2,
  RefreshCw,
  Radar,
  Shield,
  Target,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchNbaOdds, fetchUpcomingOddsEvents, LIVE_LINES_UNAVAILABLE_MESSAGE, type OddsEvent, type UpcomingOddsEvent } from "@/services/oddsApi";
import { generateDeviceFingerprint } from "@/utils/fingerprint";
import { premiumRequestHeaders } from "@/lib/premiumRequestHeaders";
import { formatOdds } from "@/utils/oddsFormat";
import { withClientPlatform } from "@/lib/edgeFunctionPath";
import { buildGameLineGrid } from "@/lib/gameLineGrid";
import { GameLineCard, MarketPill } from "@/components/game-lines/GameLineCard";
import { quoteForModelDecision } from "@/lib/gameAnalysisSelection";
import { adaptNflGameEdgeResponse, buildNflGameEdgeRequest, type NflGameEdgeResponse } from "@/lib/nflGameEdgeAdapter";
import {
  adaptGameModelResponse,
  buildGameModelRequest,
  type GameModelResponse,
} from "@/lib/gameModelAdapter";
import {
  GameAnalysisExperience,
  type GameAnalysisExperienceState,
  type GameAnalysisMarketKey,
  type GameAnalysisReport,
  type GameAnalysisReportMarket,
  type GameAnalysisReportSelection,
  type GameAnalysisScanDetails,
} from "@/components/game-analysis/GameAnalysisExperience";
import type { GameAnalysisDecision, GameAnalysisResponse } from "@/lib/gameAnalysisPresentation";

type GameLinesSport = "nba" | "wnba" | "mlb" | "nhl" | "ncaab" | "nfl";

const NFL_FORWARD_NOTE =
  "NFL markets are in forward testing: the model's read is analysis, not a pick, until that market proves profitable on graded results.";

/**
 * `nfl-game-edge` answers for moneyline, spread and total in ONE call, but the
 * Analyze screen asks per market and per side (six requests for a full game).
 * Without this the same game would be modelled six times — slow and wasteful —
 * so the in-flight response is shared per event for a short window.
 */
const NFL_RESPONSE_TTL_MS = 120_000;
const nflResponseCache = new Map<string, { at: number; promise: Promise<NflGameEdgeResponse> }>();

function nflGameEdgeResponse(
  key: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<NflGameEdgeResponse> {
  const cached = nflResponseCache.get(key);
  if (cached && Date.now() - cached.at < NFL_RESPONSE_TTL_MS) return cached.promise;
  const promise = supabase.functions
    .invoke(withClientPlatform("nfl-game-edge"), { body: payload, headers, signal })
    .then(async ({ data, error }) => {
      if (data?.error) throw new Error(data.reason ? `${data.error}: ${data.reason}` : data.error);
      if (error) {
        const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
        const payloadJson = (await context?.clone?.().json().catch(() => null)) as { error?: string; reason?: string } | null;
        if (payloadJson?.error) throw new Error(payloadJson.reason ? `${payloadJson.error}: ${payloadJson.reason}` : payloadJson.error);
        throw error;
      }
      return data as NflGameEdgeResponse;
    })
    .catch((e) => {
      nflResponseCache.delete(key);
      throw e;
    });
  nflResponseCache.set(key, { at: Date.now(), promise });
  return promise;
}

/** moneyline-api's team directory has no NFL; build it from the static NFL list. */
function nflTeamDirectory(): TeamDirectoryEntry[] {
  return listNflTeams().map(({ name, abbr }) => {
    const nickname = name.split(" ").slice(-1)[0];
    return {
      id: `nfl-${abbr}`,
      abbr: abbr.toUpperCase(),
      name,
      shortName: nickname,
      logo: getTeamLogoUrl(name, "nfl", 80),
      aliases: [nickname, abbr.toUpperCase()],
    };
  });
}
type MarketKey = "h2h" | "spreads" | "totals";
type QuoteSide = "home" | "away" | "over" | "under";
type AnalysisState = "loading" | "complete" | "unavailable" | "error";

interface TeamDirectoryEntry {
  id: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string;
  aliases?: string[];
}

interface EventTeams {
  home: TeamDirectoryEntry;
  away: TeamDirectoryEntry;
}

interface PublishedQuote {
  side: QuoteSide;
  label: string;
  price: number;
  point?: number;
}

type AnalysisDecision = GameAnalysisDecision;
type AnalysisResponse = GameAnalysisResponse;

interface MarketSnapshot {
  key: MarketKey;
  title: string;
  sportsbook: string;
  quotes: PublishedQuote[];
}

interface AnalysisEntry {
  label: string;
  quote?: PublishedQuote;
  response?: AnalysisResponse;
  error?: string;
}

interface Recommendation {
  market: string;
  side: string;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  odds: number;
  explanation: string;
}

interface ModelLean {
  market: string;
  side: string;
  heuristicScore: number;
  odds: number;
  explanation: string;
}

interface MarketAnalysis {
  state: AnalysisState;
  entries: AnalysisEntry[];
  message: string;
  recommendation?: Recommendation;
  modelLean?: ModelLean;
}

interface FullGameAnalysis {
  state: AnalysisState;
  marketsReviewed: number;
  message: string;
  recommendation?: Recommendation;
  modelLean?: ModelLean;
}

interface GameLinesBrowserProps {
  sport: GameLinesSport;
  initialHomeTeam?: string;
  initialAwayTeam?: string;
  autoAnalyze?: boolean;
  /**
   * Open straight onto one market instead of running the full-game analysis.
   * Set when the caller already knows which market the user asked for — a
   * Today's Edge card for a spread should land on the spread report, not on a
   * full-game scan that may select a different market.
   */
  initialMarket?: MarketKey;
}

const MARKET_TITLES: Record<MarketKey, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Game Total",
};

const INITIAL_DATE_COUNT = 5;

function normalizeName(value: string | undefined | null) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localMidnight(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const dayDifference = Math.round((localMidnight(date) - localMidnight(new Date())) / 86_400_000);
  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(date);
}

function mergeUpcomingEvents(publishedEvents: OddsEvent[], scheduledEvents: UpcomingOddsEvent[], sport: GameLinesSport): OddsEvent[] {
  const eventsById = new Map<string, OddsEvent>();

  for (const event of publishedEvents) {
    eventsById.set(event.id, event);
  }

  for (const event of scheduledEvents) {
    if (eventsById.has(event.id)) continue;
    eventsById.set(event.id, {
      ...event,
      sport_title: event.sport_title || sport.toUpperCase(),
      bookmakers: [],
    });
  }

  return [...eventsById.values()]
    .filter((event) => event?.commence_time && new Date(event.commence_time).getTime() > Date.now())
    .sort((first, second) => new Date(first.commence_time).getTime() - new Date(second.commence_time).getTime());
}

function matchesDirectoryTeam(eventName: string, team: TeamDirectoryEntry) {
  const normalizedEventName = normalizeName(eventName);
  return [team.name, team.shortName, team.abbr, ...(team.aliases || [])]
    .some((candidate) => normalizeName(candidate) === normalizedEventName);
}

function resolveEventTeams(event: OddsEvent, teams: TeamDirectoryEntry[]): EventTeams | null {
  const home = teams.find((team) => matchesDirectoryTeam(event.home_team, team));
  const away = teams.find((team) => matchesDirectoryTeam(event.away_team, team));
  return home && away && home.id !== away.id ? { home, away } : null;
}

function quoteForTeam(outcomes: OddsEvent["bookmakers"][number]["markets"][number]["outcomes"], teamName: string) {
  const normalizedTeamName = normalizeName(teamName);
  return outcomes.find((outcome) => normalizeName(outcome.name) === normalizedTeamName);
}

function getMarketSnapshot(event: OddsEvent, marketKey: MarketKey): MarketSnapshot | null {
  const bookmakers = [...(event.bookmakers || [])].sort((first, second) => first.title.localeCompare(second.title));

  for (const bookmaker of bookmakers) {
    const market = bookmaker.markets?.find((item) => item.key === marketKey);
    if (!market) continue;

    if (marketKey === "h2h") {
      const home = quoteForTeam(market.outcomes, event.home_team);
      const away = quoteForTeam(market.outcomes, event.away_team);
      if (!home || !away || !Number.isFinite(Number(home.price)) || !Number.isFinite(Number(away.price))) continue;
      return {
        key: marketKey,
        title: MARKET_TITLES[marketKey],
        sportsbook: bookmaker.title,
        quotes: [
          { side: "home", label: event.home_team, price: Number(home.price) },
          { side: "away", label: event.away_team, price: Number(away.price) },
        ],
      };
    }

    if (marketKey === "spreads") {
      const home = quoteForTeam(market.outcomes, event.home_team);
      const away = quoteForTeam(market.outcomes, event.away_team);
      if (
        !home || !away ||
        !Number.isFinite(Number(home.price)) || !Number.isFinite(Number(away.price)) ||
        !Number.isFinite(Number(home.point)) || !Number.isFinite(Number(away.point))
      ) continue;
      return {
        key: marketKey,
        title: MARKET_TITLES[marketKey],
        sportsbook: bookmaker.title,
        quotes: [
          { side: "home", label: event.home_team, price: Number(home.price), point: Number(home.point) },
          { side: "away", label: event.away_team, price: Number(away.price), point: Number(away.point) },
        ],
      };
    }

    const over = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "over");
    const under = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "under");
    if (
      !over || !under ||
      !Number.isFinite(Number(over.price)) || !Number.isFinite(Number(under.price)) ||
      !Number.isFinite(Number(over.point)) || !Number.isFinite(Number(under.point))
    ) continue;
    return {
      key: marketKey,
      title: MARKET_TITLES[marketKey],
      sportsbook: bookmaker.title,
      quotes: [
        { side: "over", label: "Over", price: Number(over.price), point: Number(over.point) },
        { side: "under", label: "Under", price: Number(under.price), point: Number(under.point) },
      ],
    };
  }

  return null;
}

function impliedProbability(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  const raw = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  return Math.round(raw * 1_000) / 10;
}

function responseMatchesSelectedEvent(response: AnalysisResponse | undefined, event: OddsEvent, teams: EventTeams) {
  const team1Name = response?.team1?.name || response?.team1?.shortName;
  const team2Name = response?.team2?.name || response?.team2?.shortName;
  const gameDate = response?.matchup?.gameDate;
  if (!response?.matchup?.confirmed || !gameDate) return false;
  if (response.matchup.oddsEventId && response.matchup.oddsEventId !== event.id) return false;

  const matchesInScheduledOrder = matchesDirectoryTeam(team1Name, teams.home) && matchesDirectoryTeam(team2Name, teams.away);
  const matchesInSelectedSideOrder = matchesDirectoryTeam(team1Name, teams.away) && matchesDirectoryTeam(team2Name, teams.home);
  if (!matchesInScheduledOrder && !matchesInSelectedSideOrder) return false;

  const responseTime = Date.parse(gameDate);
  const selectedTime = Date.parse(event.commence_time);
  return Number.isFinite(responseTime) && Number.isFinite(selectedTime) && Math.abs(responseTime - selectedTime) <= 90 * 60 * 1_000;
}

function quoteForDecision(
  snapshot: MarketSnapshot,
  decision: AnalysisDecision | null | undefined,
  teams: EventTeams,
) {
  return quoteForModelDecision(snapshot.quotes, decision, teams);
}

function recommendationFromAnalysis(
  entry: AnalysisEntry,
  event: OddsEvent,
  teams: EventTeams,
  snapshot: MarketSnapshot,
): Recommendation | null {
  const response = entry.response;
  const decision = response?.decision;
  const isCalibrated = response?.probability_supported === true && response?.score_kind === "calibrated_probability";
  const hasEligibleDecision = decision?.conviction_tier && decision.conviction_tier !== "noBet" && Number(decision.recommended_units) > 0;
  const modelProbability = Number(decision?.win_probability);
  const decisionQuote = quoteForDecision(snapshot, decision, teams);
  if (entry.quote && decisionQuote?.side !== entry.quote.side) return null;
  const quote = entry.quote || decisionQuote;
  const implied = quote ? impliedProbability(quote.price) : null;

  if (
    !isCalibrated || !hasEligibleDecision || !quote || !responseMatchesSelectedEvent(response, event, teams) ||
    !Number.isFinite(modelProbability) || implied == null
  ) return null;

  const edge = Math.round((modelProbability - implied) * 10) / 10;
  if (edge <= 0) return null;

  return {
    market: snapshot.title,
    side: decision?.winning_team_name || entry.label,
    modelProbability,
    impliedProbability: implied,
    edge,
    odds: quote.price,
    explanation: decision?.grade_explanation || "Validated model evidence and the live market price cleared Sentinel's recommendation gate.",
  };
}

function modelLeanFromAnalysis(
  entry: AnalysisEntry,
  event: OddsEvent,
  teams: EventTeams,
  snapshot: MarketSnapshot,
): ModelLean | null {
  const response = entry.response;
  const decision = response?.decision;
  const heuristicScore = Number(decision?.win_probability);
  const decisionQuote = quoteForDecision(snapshot, decision, teams);

  if (
    response?.probability_supported === true || response?.score_kind !== "heuristic_score" ||
    !decision?.winning_side || !decisionQuote || !responseMatchesSelectedEvent(response, event, teams) ||
    (entry.quote && decisionQuote.side !== entry.quote.side) || !Number.isFinite(heuristicScore)
  ) return null;

  return {
    market: snapshot.title,
    side: decision.winning_team_name || entry.label,
    heuristicScore: Math.round(heuristicScore),
    odds: decisionQuote.price,
    explanation: decision.grade_explanation || "The verified model has a directional lean, but it is not calibrated as a betting probability.",
  };
}

function getStoredSessionToken() {
  const remember = localStorage.getItem("primal-remember") === "true";
  const store = remember ? localStorage : sessionStorage;
  return store.getItem("primal-session-token") || localStorage.getItem("primal-session-token") || sessionStorage.getItem("primal-session-token") || "";
}

async function requestAnalysis(body: Record<string, unknown>) {
  const headers = {
    "x-session-token": getStoredSessionToken(),
    "x-device-fingerprint": await generateDeviceFingerprint(),
    "x-request-nonce": crypto.randomUUID(),
    ...(await premiumRequestHeaders()),
  };
  // MLB and WNBA now route to their own per-sport model functions. Anything
  // else (NHL, UFC, NBA) still goes to moneyline-api untouched — the new
  // endpoints are additive, not a replacement, so an unsupported sport or
  // market simply falls through to the existing path.
  const nflRequest = buildNflGameEdgeRequest(body);
  const modelRequest = nflRequest ? null : buildGameModelRequest(body);

  const controller = new AbortController();
  let timeout: number | undefined;
  let response: { data: any; error: any };
  try {
    const invocation = nflRequest
      ? nflGameEdgeResponse(
          `${nflRequest.options.oddsEventId ?? ""}|${nflRequest.options.homeTeamName}|${nflRequest.options.awayTeamName}`,
          nflRequest.payload,
          headers,
          controller.signal,
        ).then((data) => ({ data, error: null }))
      : modelRequest
      ? supabase.functions.invoke(withClientPlatform(modelRequest.fn), {
          body: modelRequest.payload,
          headers,
          signal: controller.signal,
        })
      : supabase.functions.invoke(withClientPlatform("moneyline-api/analyze"), {
          body: { ...body, __sec: headers },
          headers,
          signal: controller.signal,
        });
    response = await Promise.race([
      invocation,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          controller.abort();
          reject(new Error("The verified model check timed out. Please try again shortly."));
        }, 30_000);
      }),
    ]);
  } catch (requestError) {
    if (controller.signal.aborted) throw new Error("The verified model check timed out. Please try again shortly.");
    throw requestError;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
  const { data, error } = response;
  if (data?.error) {
    // The model endpoints return {error, reason}; keep the reason, it is the
    // part that says WHY (missing starter, unmatched game, and so on).
    throw new Error(data.reason ? `${data.error}: ${data.reason}` : data.error);
  }
  if (error) {
    const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
    const payloadPromise = context?.clone?.().json();
    const payload = (payloadPromise ? await payloadPromise.catch(() => null) : null) as { error?: unknown; reason?: unknown } | null;
    if (typeof payload?.error === "string" && payload.error) {
      throw new Error(typeof payload.reason === "string" && payload.reason ? `${payload.error}: ${payload.reason}` : payload.error);
    }
    throw error;
  }

  if (nflRequest) {
    return adaptNflGameEdgeResponse(data as NflGameEdgeResponse, nflRequest.options) as AnalysisResponse;
  }
  if (modelRequest) {
    return adaptGameModelResponse(data as GameModelResponse, {
      side: modelRequest.side,
      oddsEventId: (body.odds_event_id as string) ?? null,
    }) as AnalysisResponse;
  }
  return data as AnalysisResponse;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Minimum time the scan screen stays up.
 *
 * Analysis now returns in well under a second against a warm model, which made
 * the scan flash and vanish — the user saw a strobe rather than feedback, and
 * had no idea what work had been done. Holding it briefly makes the transition
 * legible and gives the step list time to be read as it completes.
 *
 * This never delays a SLOW analysis: it only tops up the difference when the
 * request finished early.
 */
const MIN_SCAN_MS = 4_000;

function holdScanScreen(startedAt: number): Promise<void> {
  const remaining = MIN_SCAN_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

function safeModelFailureMessage(entries: AnalysisEntry[]) {
  const failure = entries.find((entry) => entry.error)?.error || "";
  const safePrefixes = [
    "Verified MLB game context",
    "Both probable starters",
    "Official MLB",
    "Verified current-season",
    "Insufficient data",
    "Sentinel could not verify",
    "The verified model check timed out",
  ];
  return safePrefixes.some((prefix) => failure.startsWith(prefix))
    ? failure
    : "A verified model input is temporarily unavailable for this matchup.";
}

function reportSelection(
  event: OddsEvent,
  teams: EventTeams | null,
  markets: Array<{ key: MarketKey; snapshot: MarketSnapshot | null; analysis: MarketAnalysis }>,
): GameAnalysisReportSelection | undefined {
  if (!teams) return undefined;

  const candidates = markets.flatMap(({ key, snapshot, analysis }) => {
    if (!snapshot) return [];
    return analysis.entries.flatMap((entry) => {
      const response = entry.response;
      const decisionQuote = quoteForDecision(snapshot, response?.decision, teams);
      const score = Number(response?.decision?.win_probability);
      const matchesRequestedQuote = !entry.quote || decisionQuote?.side === entry.quote.side;
      if (!response || !responseMatchesSelectedEvent(response, event, teams) || !matchesRequestedQuote || !Number.isFinite(score)) return [];

      return [{
        marketKey: key,
        marketTitle: snapshot.title,
        label: response.decision?.winning_team_name || entry.label,
        quote: entry.quote || decisionQuote,
        response,
        priority: response.probability_supported === true && Number(response.decision?.recommended_units) > 0 ? 1 : 0,
        score,
      }];
    });
  });

  candidates.sort((first, second) => second.priority - first.priority || second.score - first.score);
  const winner = candidates[0];
  return winner ? {
    marketKey: winner.marketKey,
    marketTitle: winner.marketTitle,
    label: winner.label,
    quote: winner.quote,
    response: winner.response,
  } : undefined;
}

function buildGameAnalysisReport(
  event: OddsEvent,
  scope: "full" | MarketKey,
  teams: EventTeams | null,
  markets: Array<{ key: MarketKey; snapshot: MarketSnapshot | null; analysis: MarketAnalysis }>,
): GameAnalysisReport {
  const reportMarkets: GameAnalysisReportMarket[] = markets.map(({ key, snapshot, analysis }) => ({
    key: key as GameAnalysisMarketKey,
    title: snapshot?.title || MARKET_TITLES[key],
    state: analysis.state === "loading" ? "error" : analysis.state,
    message: analysis.message,
    entries: analysis.entries,
  }));
  const selected = reportSelection(event, teams, markets);
  const failures = markets.filter(({ analysis }) => analysis.state === "error").length;
  const completed = markets.filter(({ analysis }) => analysis.state === "complete").length;

  return {
    event: {
      id: event.id,
      sportTitle: event.sport_title || "Game lines",
      commenceTime: event.commence_time,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
    },
    scope,
    markets: reportMarkets,
    selected,
    message: selected
      ? "Sentinel completed the verified model review for this matchup."
      : scope !== "full" && reportMarkets[0]?.message
        ? reportMarkets[0].message
      : failures === markets.length
        ? "Sentinel could not retrieve a verified model response. Please try again shortly."
        : completed > 0
          ? "Sentinel reviewed the available markets but could not confirm a model response for this exact scheduled matchup."
          : "No verified live market was available for analysis.",
  };
}

function TeamBadge({ team, fallbackName, size = "regular" }: { team?: TeamDirectoryEntry; fallbackName: string; size?: "small" | "regular" | "hero" }) {
  const [failed, setFailed] = useState(false);
  const dimensions = size === "hero" ? "h-14 w-14" : size === "small" ? "h-7 w-7" : "h-10 w-10";
  const initials = fallbackName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  if (team?.logo && !failed) {
    return <img src={team.logo} alt={`${team.name} logo`} onError={() => setFailed(true)} className={`${dimensions} shrink-0 object-contain drop-shadow-md`} />;
  }

  return (
    <div className={`${dimensions} shrink-0 rounded-xl flex items-center justify-center text-[10px] font-black text-accent`} style={{ background: "hsla(250, 76%, 62%, 0.12)", border: "1px solid hsla(250, 76%, 62%, 0.24)" }}>
      {initials || <Shield className="h-4 w-4" />}
    </div>
  );
}

function AnalysisCallout({ analysis, full = false }: { analysis?: MarketAnalysis | FullGameAnalysis; full?: boolean }) {
  if (!analysis) return null;

  if (analysis.state === "loading") {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[11px] text-muted-foreground" style={{ background: "hsla(228,20%,8%,0.58)", border: "1px solid hsla(228,30%,18%,0.35)" }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
        Checking verified matchup data and published odds…
      </div>
    );
  }

  if (analysis.recommendation) {
    const recommendation = analysis.recommendation;
    return (
      <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: "hsla(158,64%,52%,0.08)", border: "1px solid hsla(158,64%,52%,0.25)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-nba-green">Best Bet</p>
            <p className="mt-0.5 text-[12px] font-extrabold text-foreground">{recommendation.market} · {recommendation.side}</p>
          </div>
          <span className="text-sm font-black text-nba-green">+{recommendation.edge}%</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/55">Model</p><p className="mt-0.5 text-[11px] font-bold text-foreground">{recommendation.modelProbability}%</p></div>
          <div><p className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/55">Implied</p><p className="mt-0.5 text-[11px] font-bold text-foreground">{recommendation.impliedProbability}%</p></div>
          <div><p className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/55">Price</p><p className="mt-0.5 text-[11px] font-bold text-foreground">{formatOdds(recommendation.odds)}</p></div>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{recommendation.explanation}</p>
      </div>
    );
  }

  if (analysis.modelLean) {
    const lean = analysis.modelLean;
    return (
      <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: "hsla(250,76%,62%,0.08)", border: "1px solid hsla(250,76%,62%,0.22)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent">Model Lean · Not a Bet</p>
            <p className="mt-0.5 text-[12px] font-extrabold text-foreground">{lean.market} · {lean.side}</p>
          </div>
          <span className="text-sm font-black text-accent">{lean.heuristicScore}/100</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div><p className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/55">Model score</p><p className="mt-0.5 text-[11px] font-bold text-foreground">Heuristic</p></div>
          <div><p className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/55">Live price</p><p className="mt-0.5 text-[11px] font-bold text-foreground">{formatOdds(lean.odds)}</p></div>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{lean.explanation}</p>
        <p className="text-[9px] leading-relaxed text-muted-foreground/65">This is a low-certainty model signal, not a calibrated probability or betting recommendation.</p>
        {full && "marketsReviewed" in analysis && analysis.marketsReviewed > 0 && (
          <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45">{analysis.marketsReviewed} live markets reviewed</p>
        )}
      </div>
    );
  }

  const title = analysis.state === "error" ? "Analysis Unavailable" : "No Significant Edge · No Bet";
  return (
    <div className="mt-3 rounded-xl p-3" style={{ background: "hsla(228,20%,10%,0.66)", border: "1px solid hsla(228,30%,20%,0.34)" }}>
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
        <div>
          <p className="text-[11px] font-bold text-foreground/85">{title}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">{analysis.message}</p>
          {full && "marketsReviewed" in analysis && analysis.marketsReviewed > 0 && (
            <p className="mt-1.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45">{analysis.marketsReviewed} live markets reviewed</p>
          )}
        </div>
      </div>
    </div>
  );
}

const QUOTE_ORDER: Record<QuoteSide, number> = { away: 0, home: 1, over: 0, under: 1 };

/** What a score is counted in, and what the handicap market is called, per sport. */
function sportMarketWords(sport: GameLinesSport) {
  if (sport === "mlb") return { scoring: "runs", handicap: "Run line" };
  if (sport === "nhl") return { scoring: "goals", handicap: "Puck line" };
  return { scoring: "points", handicap: "Point spread" };
}

/** One-line description under each market title, built from the live line. */
function marketSubtitle(key: MarketKey, snapshot: MarketSnapshot | null, sport: GameLinesSport): string {
  const words = sportMarketWords(sport);
  if (key === "h2h") return "Winner of the game";
  const point = snapshot?.quotes.find((quote) => quote.point != null)?.point;
  if (key === "spreads") return point != null ? `${words.handicap} ±${Math.abs(point)}` : words.handicap;
  return point != null ? `Combined ${words.scoring} · ${point}` : `Combined ${words.scoring}`;
}

/** A total's number is a threshold (no sign); a spread's is a handicap (signed). */
function quotePointSuffix(quote: PublishedQuote): string {
  if (quote.point == null) return "";
  if (quote.side === "over" || quote.side === "under") return ` ${quote.point}`;
  return ` ${quote.point > 0 ? "+" : ""}${quote.point}`;
}

function MarketCard({
  marketKey,
  snapshot,
  title,
  sport,
  teams,
  analysis,
  onAnalyze,
  marketFeedUnavailable = false,
}: {
  marketKey: MarketKey;
  snapshot: MarketSnapshot | null;
  title: string;
  sport: GameLinesSport;
  teams: EventTeams | null;
  analysis?: MarketAnalysis;
  onAnalyze: () => void;
  marketFeedUnavailable?: boolean;
}) {
  const loading = analysis?.state === "loading";

  // The shortest price is the book's favourite; its bar is drawn in the accent
  // so the market reads at a glance instead of as two bare numbers.
  const shortest = snapshot?.quotes.reduce<number | null>(
    (min, quote) => (min === null || quote.price < min ? quote.price : min),
    null,
  ) ?? null;

  const labelFor = (quote: PublishedQuote) => {
    const team = quote.side === "home" ? teams?.home : quote.side === "away" ? teams?.away : undefined;
    return `${team?.shortName || quote.label}${quotePointSuffix(quote)}`;
  };

  const badgeFor = (quote: PublishedQuote) => {
    if (quote.side === "over" || quote.side === "under") {
      return (
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-black text-foreground/80"
          style={{ background: "hsla(228,24%,18%,0.9)", border: "1px solid hsla(228,30%,28%,0.6)" }}
        >
          {quote.side === "over" ? "O" : "U"}
        </span>
      );
    }
    const team = quote.side === "home" ? teams?.home : teams?.away;
    return <TeamBadge team={team} fallbackName={quote.label} size="small" />;
  };

  return (
    <div className="vision-card p-4" style={{ borderColor: "hsla(228,30%,22%,0.4)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-extrabold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">{marketSubtitle(marketKey, snapshot, sport)}</p>
        </div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!snapshot || loading}
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold text-nba-green transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "hsla(228,24%,14%,0.9)", border: "1px solid hsla(228,30%,24%,0.6)" }}
          aria-label={`Analyze ${title}`}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
          Analyze
        </button>
      </div>

      {snapshot ? (
        <div className={`mt-3 grid gap-2 ${snapshot.quotes.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {/* Away (and Over) first, so each tile sits on the same side as its
              team in the matchup card above; the book lists home first. */}
          {[...snapshot.quotes].sort((a, b) => QUOTE_ORDER[a.side] - QUOTE_ORDER[b.side]).map((quote) => {
            const implied = impliedProbability(quote.price);
            const isFavourite = shortest !== null && quote.price === shortest;
            return (
              <div
                key={quote.side}
                className="rounded-xl p-3"
                style={{ background: "hsla(228,24%,10%,0.85)", border: "1px solid hsla(228,30%,22%,0.45)" }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {badgeFor(quote)}
                  <span className="truncate text-[12px] font-bold text-foreground/90">{labelFor(quote)}</span>
                </div>
                <p className={`mt-2.5 text-[24px] font-black leading-none tabular-nums ${quote.price > 0 ? "text-nba-green" : "text-foreground"}`}>
                  {formatOdds(quote.price)}
                </p>
                {implied !== null && (
                  <div className="mt-2.5">
                    {/* Implied probability from the price itself — the book's
                        number, shown so the model's score has something to be
                        compared against. */}
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "hsla(228,24%,22%,0.8)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, implied)}%`,
                          background: isFavourite ? "hsl(250 76% 68%)" : "hsla(228,20%,55%,0.55)",
                        }}
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground/55">{implied}% implied</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
          {marketFeedUnavailable
            ? "Live odds could not be verified right now. Refresh to try again before running analysis."
            : `No verified live ${title.toLowerCase()} is currently returned for this matchup.`}
        </p>
      )}
    </div>
  );
}

export function GameLinesBrowser({ sport, initialHomeTeam, initialAwayTeam, autoAnalyze = false, initialMarket }: GameLinesBrowserProps) {
  const [events, setEvents] = useState<OddsEvent[]>([]);
  const [teamDirectory, setTeamDirectory] = useState<TeamDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marketFeedUnavailable, setMarketFeedUnavailable] = useState(false);
  const [visibleDateCount, setVisibleDateCount] = useState(INITIAL_DATE_COUNT);
  const [selectedEvent, setSelectedEvent] = useState<OddsEvent | null>(null);
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, Partial<Record<MarketKey, MarketAnalysis>>>>({});
  const [fullAnalyses, setFullAnalyses] = useState<Record<string, FullGameAnalysis>>({});
  const [analysisExperience, setAnalysisExperience] = useState<GameAnalysisExperienceState | null>(null);
  // Identifies the analysis run on screen. Cancelling bumps it, so a run that
  // finishes afterwards sees it is stale and never reopens the report. The
  // requests themselves still complete — they are independent server calls —
  // but their result is discarded instead of taking over the screen.
  const analysisRunRef = useRef(0);
  const initialNavigationHandled = useRef("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    setMarketFeedUnavailable(false);
    try {
      const [oddsResult, scheduleResult, teamsResult] = await Promise.allSettled([
        fetchNbaOdds(undefined, "h2h,spreads,totals", sport),
        fetchUpcomingOddsEvents(sport),
        sport === "nfl"
          ? Promise.resolve({ data: nflTeamDirectory() })
          : supabase.functions.invoke("moneyline-api/teams", { body: { sport } }),
      ]);
      const rawPublishedEvents = oddsResult.status === "fulfilled"
        ? (Array.isArray(oddsResult.value) ? oddsResult.value : oddsResult.value?.events)
        : [];
      const scheduledEvents = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
      const upcomingEvents = mergeUpcomingEvents(
        Array.isArray(rawPublishedEvents) ? rawPublishedEvents : [],
        scheduledEvents,
        sport,
      );

      if (upcomingEvents.length === 0 && oddsResult.status === "rejected" && scheduleResult.status === "rejected") {
        throw new Error(LIVE_LINES_UNAVAILABLE_MESSAGE);
      }

      setEvents(upcomingEvents);
      setMarketFeedUnavailable(oddsResult.status === "rejected");
      setTeamDirectory(teamsResult.status === "fulfilled" && Array.isArray(teamsResult.value.data) ? teamsResult.value.data : []);
    } catch {
      setEvents([]);
      setTeamDirectory([]);
      setMarketFeedUnavailable(true);
      setError(LIVE_LINES_UNAVAILABLE_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    setVisibleDateCount(INITIAL_DATE_COUNT);
    setSelectedEvent(null);
    setMarketAnalyses({});
    setFullAnalyses({});
    void loadEvents();
  }, [loadEvents]);

  // A refresh replaces `events`; re-point the open game at its fresh copy so
  // the detail view shows the new odds instead of the ones it opened with.
  // If the game has dropped out of the feed (it started), keep what we have.
  useEffect(() => {
    setSelectedEvent((current) => (current ? events.find((event) => event.id === current.id) ?? current : current));
  }, [events]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, OddsEvent[]>();
    for (const event of events) {
      const key = dateKey(event.commence_time);
      groups.set(key, [...(groups.get(key) || []), event]);
    }
    return [...groups.entries()].map(([date, games]) => ({ date, games }));
  }, [events]);

  const setMarketAnalysis = useCallback((eventId: string, market: MarketKey, analysis: MarketAnalysis) => {
    setMarketAnalyses((current) => ({
      ...current,
      [eventId]: { ...current[eventId], [market]: analysis },
    }));
  }, []);

  const buildRequests = useCallback((event: OddsEvent, teams: EventTeams, snapshot: MarketSnapshot) => {
    const eventContext = {
      sport,
      odds_event_id: event.id,
      odds_commence_time: event.commence_time,
      odds_home_team: event.home_team,
      odds_away_team: event.away_team,
      sportsbook: snapshot.sportsbook,
    };
    const teamsForSide = (side: QuoteSide) => side === "home"
      ? { selected: teams.home, opponent: teams.away }
      : { selected: teams.away, opponent: teams.home };

    if (snapshot.key === "h2h") {
      return snapshot.quotes
        .filter((quote) => quote.side === "home" || quote.side === "away")
        .map((quote) => {
          const selection = teamsForSide(quote.side);
          return {
            label: quote.label,
            quote,
            body: {
              ...eventContext,
              team1: selection.selected.name,
              team2: selection.opponent.name,
              bet_type: "moneyline",
              american_odds: quote.price,
            },
          };
        });
    }
    if (snapshot.key === "spreads") {
      return snapshot.quotes
        .filter((quote) => quote.side === "home" || quote.side === "away")
        .map((quote) => {
          const selection = teamsForSide(quote.side);
          return {
            label: `${quote.label} ${quote.point! > 0 ? "+" : ""}${quote.point}`,
            quote,
            body: {
              ...eventContext,
              team1: selection.selected.name,
              team2: selection.opponent.name,
              bet_type: "spread",
              spread_team: selection.selected.name,
              spread_line: quote.point,
              american_odds: quote.price,
            },
          };
        });
    }
    return snapshot.quotes
      .filter((quote) => quote.side === "over" || quote.side === "under")
      .map((quote) => ({
        label: `${quote.label} ${quote.point}`,
        quote,
        body: {
          ...eventContext,
          team1: teams.home.name,
          team2: teams.away.name,
          bet_type: "total",
          total_line: quote.point,
          over_under: quote.side,
          american_odds: quote.price,
        },
      }));
  }, [sport]);

  const analyzeMarket = useCallback(async (event: OddsEvent, market: MarketKey): Promise<MarketAnalysis> => {
    const teams = resolveEventTeams(event, teamDirectory);
    const snapshot = getMarketSnapshot(event, market);
    if (!teams) {
      const unavailable = { state: "unavailable" as const, entries: [], message: "Sentinel could not verify both sportsbook teams against its league directory, so analysis is blocked for this event." };
      setMarketAnalysis(event.id, market, unavailable);
      return unavailable;
    }
    if (!snapshot) {
      const unavailable = { state: "unavailable" as const, entries: [], message: `No verified live ${MARKET_TITLES[market].toLowerCase()} is currently available from one sportsbook source.` };
      setMarketAnalysis(event.id, market, unavailable);
      return unavailable;
    }

    setMarketAnalysis(event.id, market, { state: "loading", entries: [], message: "Checking verified matchup data and live odds…" });
    const entries = await Promise.all(buildRequests(event, teams, snapshot).map(async (request): Promise<AnalysisEntry> => {
      try {
        return { label: request.label, quote: request.quote, response: await requestAnalysis(request.body) };
      } catch (requestError: unknown) {
        return { label: request.label, quote: request.quote, error: errorMessage(requestError, "Analysis request failed.") };
      }
    }));
    const recommendation = entries
      .map((entry) => recommendationFromAnalysis(entry, event, teams, snapshot))
      .filter((candidate): candidate is Recommendation => candidate !== null)
      .sort((first, second) => second.edge - first.edge)[0];
    const modelLean = entries
      .map((entry) => modelLeanFromAnalysis(entry, event, teams, snapshot))
      .filter((candidate): candidate is ModelLean => candidate !== null)
      .sort((first, second) => second.heuristicScore - first.heuristicScore)[0];
    const hasRequestFailure = entries.some((entry) => entry.error);
    const hasUnconfirmedMatchup = entries.some((entry) => entry.response && !responseMatchesSelectedEvent(entry.response, event, teams));
    const analysis: MarketAnalysis = {
      state: hasRequestFailure && entries.every((entry) => entry.error) ? "error" : "complete",
      entries,
      recommendation,
      modelLean,
      message: recommendation
        ? "Sentinel found a validated model edge against this exact live price."
        : modelLean
          ? `The verified model leans ${modelLean.side}, but it did not pass Sentinel's calibrated betting threshold.`
        : hasUnconfirmedMatchup
          ? "The model response could not confirm this exact scheduled event, so Sentinel will not attach a recommendation."
          : hasRequestFailure
            ? safeModelFailureMessage(entries)
            : "The model is uncalibrated or did not meet Sentinel's quality gate. Probabilities, edge, and a pick are withheld.",
    };
    setMarketAnalysis(event.id, market, analysis);
    return analysis;
  }, [buildRequests, setMarketAnalysis, teamDirectory]);

  const scanDetailsFor = useCallback((event: OddsEvent): GameAnalysisScanDetails => {
    const teams = resolveEventTeams(event, teamDirectory);
    return {
      awayShortName: teams?.away.shortName || null,
      homeShortName: teams?.home.shortName || null,
      awayAbbr: teams?.away.abbr || null,
      homeAbbr: teams?.home.abbr || null,
      marketsAvailable: (["h2h", "spreads", "totals"] as MarketKey[]).filter((market) => getMarketSnapshot(event, market)).length,
      phase: "models",
    };
  }, [teamDirectory]);

  /** Marks the model step done on the scan screen, if this run is still the one showing. */
  const markModelsDone = useCallback((runId: number) => {
    if (analysisRunRef.current !== runId) return;
    setAnalysisExperience((current) => current?.stage === "scanning"
      ? { ...current, details: { ...current.details, phase: "report" } }
      : current);
  }, []);

  const closeAnalysis = useCallback(() => {
    analysisRunRef.current += 1;
    setAnalysisExperience(null);
  }, []);

  const analyzeFullGame = useCallback(async (event: OddsEvent) => {
    const runId = ++analysisRunRef.current;
    const scanStartedAt = Date.now();
    setAnalysisExperience({
      stage: "scanning",
      event: { id: event.id, sportTitle: event.sport_title || "Game lines", commenceTime: event.commence_time, homeTeam: event.home_team, awayTeam: event.away_team },
      scope: "full",
      details: scanDetailsFor(event),
    });
    setFullAnalyses((current) => ({ ...current, [event.id]: { state: "loading", marketsReviewed: 0, message: "Comparing every published market for this verified matchup…" } }));
    const analyses = await Promise.all(
      (["h2h", "spreads", "totals"] as MarketKey[]).map((market) => analyzeMarket(event, market)),
    );
    markModelsDone(runId);
    if (analysisRunRef.current === runId) await holdScanScreen(scanStartedAt);
    const recommendation = analyses
      .map((analysis) => analysis.recommendation)
      .filter((candidate): candidate is Recommendation => candidate !== undefined)
      .sort((first, second) => second.edge - first.edge)[0];
    const modelLean = analyses
      .map((analysis) => analysis.modelLean)
      .filter((candidate): candidate is ModelLean => candidate !== undefined)
      .sort((first, second) => second.heuristicScore - first.heuristicScore)[0];
    const marketsReviewed = analyses.filter((analysis) => analysis.state === "complete").length;
    setFullAnalyses((current) => ({
      ...current,
      [event.id]: {
        state: marketsReviewed > 0 ? "complete" : "unavailable",
        marketsReviewed,
        recommendation,
        modelLean,
        message: recommendation
          ? "Sentinel compared the available live markets and selected the strongest validated opportunity."
          : modelLean
            ? `Sentinel's strongest verified model lean is ${modelLean.market} · ${modelLean.side}, but it remains a pass until calibrated.`
          : marketsReviewed > 0
            ? "Sentinel reviewed the available live markets. None met the probability and edge requirements, so this matchup is a pass."
            : "No market could be safely analyzed for this matchup.",
      },
    }));
    // The inline game card still gets its result above; only the full-screen
    // report is suppressed when the user cancelled.
    if (analysisRunRef.current !== runId) return;
    const marketKeys = ["h2h", "spreads", "totals"] as MarketKey[];
    setAnalysisExperience({
      stage: "report",
      report: buildGameAnalysisReport(
        event,
        "full",
        resolveEventTeams(event, teamDirectory),
        marketKeys.map((key, index) => ({ key, snapshot: getMarketSnapshot(event, key), analysis: analyses[index] })),
      ),
    });
  }, [analyzeMarket, markModelsDone, scanDetailsFor, teamDirectory]);

  const analyzeSingleMarket = useCallback(async (event: OddsEvent, market: MarketKey) => {
    const runId = ++analysisRunRef.current;
    const scanStartedAt = Date.now();
    setAnalysisExperience({
      stage: "scanning",
      event: { id: event.id, sportTitle: event.sport_title || "Game lines", commenceTime: event.commence_time, homeTeam: event.home_team, awayTeam: event.away_team },
      scope: market,
      details: scanDetailsFor(event),
    });
    const analysis = await analyzeMarket(event, market);
    markModelsDone(runId);
    if (analysisRunRef.current !== runId) return;
    await holdScanScreen(scanStartedAt);
    if (analysisRunRef.current !== runId) return;
    setAnalysisExperience({
      stage: "report",
      report: buildGameAnalysisReport(event, market, resolveEventTeams(event, teamDirectory), [{ key: market, snapshot: getMarketSnapshot(event, market), analysis }]),
    });
  }, [analyzeMarket, markModelsDone, scanDetailsFor, teamDirectory]);

  useEffect(() => {
    const navigationKey = `${sport}:${initialHomeTeam || ""}:${initialAwayTeam || ""}:${initialMarket || "full"}`;
    if (!initialHomeTeam || !initialAwayTeam || initialNavigationHandled.current === navigationKey || events.length === 0) return;
    const matchingEvent = events.find((event) => normalizeName(event.home_team) === normalizeName(initialHomeTeam) && normalizeName(event.away_team) === normalizeName(initialAwayTeam));
    if (!matchingEvent) return;
    initialNavigationHandled.current = navigationKey;
    setSelectedEvent(matchingEvent);
    if (!autoAnalyze) return;
    // A caller that named a market wants that market's report. Running the
    // full-game scan instead can surface a different market entirely, which is
    // how tapping Details on a spread card produced a moneyline view.
    if (initialMarket) void analyzeSingleMarket(matchingEvent, initialMarket);
    else void analyzeFullGame(matchingEvent);
  }, [analyzeFullGame, analyzeSingleMarket, autoAnalyze, events, initialAwayTeam, initialHomeTeam, initialMarket, sport]);

  if (selectedEvent) {
    const teams = resolveEventTeams(selectedEvent, teamDirectory);
    const snapshots = {
      h2h: getMarketSnapshot(selectedEvent, "h2h"),
      spreads: getMarketSnapshot(selectedEvent, "spreads"),
      totals: getMarketSnapshot(selectedEvent, "totals"),
    };
    const marketAnalysesForEvent = marketAnalyses[selectedEvent.id] || {};
    const fullAnalysis = fullAnalyses[selectedEvent.id];
    const availableMarkets = Object.values(snapshots).filter(Boolean).length;
    const sportsbook = snapshots.h2h?.sportsbook || snapshots.spreads?.sportsbook || snapshots.totals?.sportsbook || null;
    const kickoff = new Date(selectedEvent.commence_time);
    const kickoffLabel = `${dateLabel(dateKey(selectedEvent.commence_time))} ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(kickoff)}`;
    const awayName = teams?.away.shortName || selectedEvent.away_team;
    const homeName = teams?.home.shortName || selectedEvent.home_team;

    return (
      <section className="space-y-3">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedEvent(null)}
            aria-label="Back to all game lines"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-foreground transition-colors hover:bg-white/[0.08]"
            style={{ background: "hsla(228,24%,14%,0.9)", border: "1px solid hsla(228,30%,24%,0.6)" }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-black uppercase tracking-[0.03em] text-foreground">Game lines</h2>
            <p className="text-[10px] text-muted-foreground/60">{selectedEvent.sport_title || sport.toUpperCase()} · {kickoffLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadEvents()}
            disabled={loading}
            aria-label="Refresh live game lines"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40"
            style={{ background: "hsla(228,24%,14%,0.9)", border: "1px solid hsla(228,30%,24%,0.6)" }}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </header>

        <div className="vision-card p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamBadge team={teams?.away} fallbackName={selectedEvent.away_team} />
              <div className="min-w-0 leading-tight">
                <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground/50">Away</p>
                <p className="truncate text-[16px] font-extrabold text-foreground">{awayName}</p>
              </div>
            </div>
            <span className="text-[15px] font-black text-nba-green">@</span>
            <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
              <div className="min-w-0 leading-tight">
                <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground/50">Home</p>
                <p className="truncate text-[16px] font-extrabold text-foreground">{homeName}</p>
              </div>
              <TeamBadge team={teams?.home} fallbackName={selectedEvent.home_team} />
            </div>
          </div>
          <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
            <p className="truncate text-[11px] text-muted-foreground/65">
              {sportsbook ? <>Odds via <span className="font-bold text-foreground/90">{sportsbook}</span></> : "Odds not posted yet"}
            </p>
            <MarketPill status={availableMarkets > 0 ? "live" : marketFeedUnavailable ? "unavailable" : "none"} count={availableMarkets} />
          </div>
          {!teams && <p className="mt-2 text-[9px] font-semibold text-nba-yellow">Team verification pending</p>}
        </div>

        <div
          className="rounded-[1.25rem] p-4"
          style={{
            background: "linear-gradient(150deg, hsla(158,64%,52%,0.09), hsla(228,30%,8%,0.6) 60%)",
            border: "1px solid hsla(158,64%,52%,0.28)",
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-nba-green"
              style={{ background: "hsla(158,64%,52%,0.1)", border: "1px solid hsla(158,64%,52%,0.3)" }}
            >
              <Target className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-extrabold text-foreground">Full-game analysis</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
                Checks {availableMarkets > 0 ? `all ${availableMarkets}` : "every"} market{availableMarkets === 1 ? "" : "s"} at once. A pick only shows when the event, live price and model evidence agree.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void analyzeFullGame(selectedEvent)}
            disabled={fullAnalysis?.state === "loading" || availableMarkets === 0 || !teams}
            className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-nba-green py-3.5 text-[13px] font-bold text-[#06140d] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {fullAnalysis?.state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            Analyze full game
          </button>
          {sport === "nfl" && <p className="mt-2 text-[10px] leading-relaxed text-nba-yellow/80">{NFL_FORWARD_NOTE}</p>}
        </div>

        <div className="flex items-center justify-between px-1 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/75">Markets</span>
          <span className="text-[10px] text-muted-foreground/50">Bar = implied probability</span>
        </div>

        <MarketCard marketKey="h2h" snapshot={snapshots.h2h} title="Moneyline" sport={sport} teams={teams} analysis={marketAnalysesForEvent.h2h} onAnalyze={() => void analyzeSingleMarket(selectedEvent, "h2h")} marketFeedUnavailable={marketFeedUnavailable} />
        <MarketCard marketKey="spreads" snapshot={snapshots.spreads} title="Spread" sport={sport} teams={teams} analysis={marketAnalysesForEvent.spreads} onAnalyze={() => void analyzeSingleMarket(selectedEvent, "spreads")} marketFeedUnavailable={marketFeedUnavailable} />
        <MarketCard marketKey="totals" snapshot={snapshots.totals} title="Game Total" sport={sport} teams={teams} analysis={marketAnalysesForEvent.totals} onAnalyze={() => void analyzeSingleMarket(selectedEvent, "totals")} marketFeedUnavailable={marketFeedUnavailable} />
        <GameAnalysisExperience experience={analysisExperience} onClose={closeAnalysis} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="vision-card relative overflow-hidden p-4">
        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-15 blur-2xl" style={{ background: "hsl(250 76% 62%)" }} />
        <div className="relative flex items-start justify-between gap-3"><div><p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent/75">Live Game Lines</p><h2 className="mt-1 text-base font-extrabold text-foreground">Upcoming {sport.toUpperCase()} matchups</h2><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/65">Published sportsbook odds only. Open a game to compare markets or run a verified analysis.{sport === "nfl" ? ` ${NFL_FORWARD_NOTE}` : ""}</p></div><button type="button" onClick={() => void loadEvents()} disabled={loading} className="rounded-lg p-2 text-muted-foreground/65 transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-40" aria-label="Refresh live game lines"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button></div>
      </div>

      {loading && <div className="flex flex-col items-center justify-center py-12 text-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /><p className="mt-3 text-xs font-semibold text-muted-foreground">Loading live sportsbook events…</p></div>}
      {!loading && error && <div className="rounded-xl p-4 text-center" style={{ background: "hsla(0,72%,51%,0.08)", border: "1px solid hsla(0,72%,51%,0.22)" }}><CircleAlert className="mx-auto h-5 w-5 text-nba-red" /><p className="mt-2 text-xs font-semibold text-foreground">Live lines temporarily unavailable</p><p className="mt-1 text-[10px] text-muted-foreground/70">Please try again shortly.</p></div>}
      {!loading && !error && groupedEvents.length === 0 && <div className="vision-card p-6 text-center"><CalendarDays className="mx-auto h-6 w-6 text-muted-foreground/45" /><p className="mt-3 text-xs font-semibold text-foreground/80">No upcoming live lines</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/60">Sportsbooks have not posted upcoming {sport.toUpperCase()} game markets yet.</p></div>}

      {!loading && !error && marketFeedUnavailable && groupedEvents.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground/70" style={{ background: "hsla(42,92%,55%,0.07)", border: "1px solid hsla(42,92%,55%,0.18)" }}>
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nba-yellow" />
          Upcoming games are shown, but live sportsbook markets could not be verified. Refresh to try again; analysis stays disabled until a market is returned.
        </div>
      )}

      {!loading && !error && groupedEvents.slice(0, visibleDateCount).map((group) => (
        <div key={group.date} className="space-y-2.5">
          <div className="px-1 pt-1">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-nba-green">
              <span className="h-1.5 w-1.5 rounded-full bg-nba-green" style={{ boxShadow: "0 0 6px hsl(158 64% 52%)" }} />
              {dateLabel(group.date)}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <h3 className="text-[17px] font-extrabold tracking-tight text-foreground">
                {group.games.length} {sport.toUpperCase()} matchup{group.games.length === 1 ? "" : "s"}
              </h3>
              <span className="shrink-0 text-[10px] text-muted-foreground/55">Published sportsbook odds</span>
            </div>
          </div>
          {group.games.map((event, index) => {
            const teams = resolveEventTeams(event, teamDirectory);
            const snapshots = {
              h2h: getMarketSnapshot(event, "h2h"),
              spreads: getMarketSnapshot(event, "spreads"),
              totals: getMarketSnapshot(event, "totals"),
            };
            const grid = buildGameLineGrid(snapshots);
            const kickoff = new Date(event.commence_time);
            return (
              <GameLineCard
                key={event.id}
                index={index}
                time={new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(kickoff)}
                dayLabel={dateLabel(dateKey(event.commence_time))}
                away={{ name: event.away_team, shortName: teams?.away.shortName, badge: <TeamBadge team={teams?.away} fallbackName={event.away_team} /> }}
                home={{ name: event.home_team, shortName: teams?.home.shortName, badge: <TeamBadge team={teams?.home} fallbackName={event.home_team} /> }}
                grid={grid}
                marketStatus={grid.liveMarkets > 0 ? "live" : marketFeedUnavailable ? "unavailable" : "none"}
                teamsVerified={Boolean(teams)}
                canAnalyze={Boolean(teams) && grid.liveMarkets > 0}
                onViewLines={() => setSelectedEvent(event)}
                onAnalyze={() => { setSelectedEvent(event); void analyzeFullGame(event); }}
              />
            );
          })}
        </div>
      ))}

      {!loading && visibleDateCount < groupedEvents.length && <button type="button" onClick={() => setVisibleDateCount((current) => current + INITIAL_DATE_COUNT)} className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-bold text-accent transition-colors hover:bg-accent/10" style={{ border: "1px solid hsla(250,76%,62%,0.2)", background: "hsla(250,76%,62%,0.06)" }}>Show next dates <ChevronRight className="h-3.5 w-3.5" /></button>}
    </section>
  );
}
