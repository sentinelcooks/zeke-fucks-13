import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchNbaOdds, fetchUpcomingOddsEvents, LIVE_LINES_UNAVAILABLE_MESSAGE, type OddsEvent, type UpcomingOddsEvent } from "@/services/oddsApi";
import { generateDeviceFingerprint } from "@/utils/fingerprint";
import { premiumRequestHeaders } from "@/lib/premiumRequestHeaders";
import { formatOdds } from "@/utils/oddsFormat";
import { getMobilePlatform } from "@/lib/mobileDeviceIdentity";
import {
  GameAnalysisExperience,
  type GameAnalysisExperienceState,
  type GameAnalysisMarketKey,
  type GameAnalysisReport,
  type GameAnalysisReportMarket,
  type GameAnalysisReportSelection,
} from "@/components/game-analysis/GameAnalysisExperience";
import type { GameAnalysisDecision, GameAnalysisResponse } from "@/lib/gameAnalysisPresentation";

type GameLinesSport = "nba" | "wnba" | "mlb" | "nhl" | "ncaab";
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

function gameTimeLabel(value: string) {
  const date = new Date(value);
  return `${dateLabel(dateKey(value))} · ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
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

function quoteForDecision(snapshot: MarketSnapshot, decision: AnalysisDecision | null | undefined) {
  const side = decision?.winning_side === "team1"
    ? "home"
    : decision?.winning_side === "team2"
      ? "away"
      : decision?.winning_side;
  return snapshot.quotes.find((quote) => quote.side === side);
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
  const decisionQuote = quoteForDecision(snapshot, decision);
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
  const decisionQuote = quoteForDecision(snapshot, decision);

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
  const platform = encodeURIComponent(getMobilePlatform());
  const { data, error } = await supabase.functions.invoke(`moneyline-api/analyze?client_platform=${platform}`, {
    body: { ...body, __sec: headers },
    headers,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as AnalysisResponse;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
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
      const decisionQuote = quoteForDecision(snapshot, response?.decision);
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

function MarketCard({ snapshot, title, analysis, onAnalyze, marketFeedUnavailable = false }: { snapshot: MarketSnapshot | null; title: string; analysis?: MarketAnalysis; onAnalyze: () => void; marketFeedUnavailable?: boolean }) {
  return (
    <div className="vision-card p-4" style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {snapshot && <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-muted-foreground/55">Live at {snapshot.sportsbook}</p>}
        </div>
        {snapshot && <span className="rounded-md px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-nba-green" style={{ background: "hsla(158,64%,52%,0.1)" }}>Live</span>}
      </div>

      {snapshot ? (
        <div className="mt-3 divide-y divide-border/30">
          {snapshot.quotes.map((quote) => (
            <div key={quote.side} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-[12px] font-semibold text-foreground/90">{quote.label}{quote.point != null ? ` ${quote.point > 0 ? "+" : ""}${quote.point}` : ""}</span>
              <span className="shrink-0 font-mono text-sm font-black text-foreground">{formatOdds(quote.price)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground/60">
          {marketFeedUnavailable
            ? "Live odds could not be verified right now. Refresh to try again before running analysis."
            : `No verified live ${title.toLowerCase()} is currently returned for this matchup.`}
        </p>
      )}

      <button type="button" onClick={onAnalyze} disabled={!snapshot || analysis?.state === "loading"} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[11px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-45" style={{ background: "hsla(250,76%,62%,0.13)", border: "1px solid hsla(250,76%,62%,0.25)", color: "hsl(250 90% 78%)" }}>
        {analysis?.state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Analyze {title}
      </button>
    </div>
  );
}

export function GameLinesBrowser({ sport, initialHomeTeam, initialAwayTeam, autoAnalyze = false }: GameLinesBrowserProps) {
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
  const initialNavigationHandled = useRef("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    setMarketFeedUnavailable(false);
    try {
      const [oddsResult, scheduleResult, teamsResult] = await Promise.allSettled([
        fetchNbaOdds(undefined, "h2h,spreads,totals", sport),
        fetchUpcomingOddsEvents(sport),
        supabase.functions.invoke("moneyline-api/teams", { body: { sport } }),
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
      return snapshot.quotes.map((quote) => {
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
      return snapshot.quotes.map((quote) => {
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
    return snapshot.quotes.map((quote) => ({
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
    const entries = await Promise.all(buildRequests(event, teams, snapshot).map(async (request) => {
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
            ? "Sentinel could not complete every verified market check. No recommendation is shown."
            : "The model is uncalibrated or did not meet Sentinel's quality gate. Probabilities, edge, and a pick are withheld.",
    };
    setMarketAnalysis(event.id, market, analysis);
    return analysis;
  }, [buildRequests, setMarketAnalysis, teamDirectory]);

  const analyzeFullGame = useCallback(async (event: OddsEvent) => {
    setAnalysisExperience({
      stage: "scanning",
      event: { id: event.id, sportTitle: event.sport_title || "Game lines", commenceTime: event.commence_time, homeTeam: event.home_team, awayTeam: event.away_team },
      scope: "full",
    });
    setFullAnalyses((current) => ({ ...current, [event.id]: { state: "loading", marketsReviewed: 0, message: "Comparing every published market for this verified matchup…" } }));
    const analyses = await Promise.all((["h2h", "spreads", "totals"] as MarketKey[]).map((market) => analyzeMarket(event, market)));
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
  }, [analyzeMarket, teamDirectory]);

  const analyzeSingleMarket = useCallback(async (event: OddsEvent, market: MarketKey) => {
    setAnalysisExperience({
      stage: "scanning",
      event: { id: event.id, sportTitle: event.sport_title || "Game lines", commenceTime: event.commence_time, homeTeam: event.home_team, awayTeam: event.away_team },
      scope: market,
    });
    const analysis = await analyzeMarket(event, market);
    setAnalysisExperience({
      stage: "report",
      report: buildGameAnalysisReport(event, market, resolveEventTeams(event, teamDirectory), [{ key: market, snapshot: getMarketSnapshot(event, market), analysis }]),
    });
  }, [analyzeMarket, teamDirectory]);

  useEffect(() => {
    const navigationKey = `${sport}:${initialHomeTeam || ""}:${initialAwayTeam || ""}`;
    if (!initialHomeTeam || !initialAwayTeam || initialNavigationHandled.current === navigationKey || events.length === 0) return;
    const matchingEvent = events.find((event) => normalizeName(event.home_team) === normalizeName(initialHomeTeam) && normalizeName(event.away_team) === normalizeName(initialAwayTeam));
    if (!matchingEvent) return;
    initialNavigationHandled.current = navigationKey;
    setSelectedEvent(matchingEvent);
    if (autoAnalyze) void analyzeFullGame(matchingEvent);
  }, [analyzeFullGame, autoAnalyze, events, initialAwayTeam, initialHomeTeam, sport]);

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

    return (
      <section className="space-y-3">
        <button type="button" onClick={() => setSelectedEvent(null)} className="flex items-center gap-1.5 px-1 text-[11px] font-bold text-muted-foreground/70 transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All Game Lines
        </button>

        <div className="vision-card relative overflow-hidden p-4">
          <div className="absolute -top-10 left-1/2 h-28 w-48 -translate-x-1/2 rounded-full opacity-20 blur-3xl" style={{ background: "hsl(250 76% 62%)" }} />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-lg px-2 py-1 text-[8px] font-bold uppercase tracking-[0.15em] text-accent" style={{ background: "hsla(250,76%,62%,0.13)", border: "1px solid hsla(250,76%,62%,0.22)" }}>{selectedEvent.sport_title || sport.toUpperCase()}</span>
              <span className="text-[10px] font-semibold text-muted-foreground/65">{gameTimeLabel(selectedEvent.commence_time)}</span>
            </div>
            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
              <div className="flex flex-col items-center gap-2"><TeamBadge team={teams?.away} fallbackName={selectedEvent.away_team} size="hero" /><span className="text-[12px] font-bold leading-tight text-foreground">{selectedEvent.away_team}</span><span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50">Away</span></div>
              <span className="text-xl font-black text-accent">VS</span>
              <div className="flex flex-col items-center gap-2"><TeamBadge team={teams?.home} fallbackName={selectedEvent.home_team} size="hero" /><span className="text-[12px] font-bold leading-tight text-foreground">{selectedEvent.home_team}</span><span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50">Home</span></div>
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[9px] font-semibold text-muted-foreground/60"><BarChart3 className="h-3.5 w-3.5 text-nba-green" />{availableMarkets} live market{availableMarkets === 1 ? "" : "s"} available</p>
          </div>
        </div>

        <div className="vision-card p-4">
          <div className="flex items-start justify-between gap-4"><div><p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent/75">Sentinel Full-Game Analysis</p><h2 className="mt-1 text-sm font-bold text-foreground">Compare all live markets</h2><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/65">Moneyline, spread, and game total are checked independently. A pick appears only when the event, live price, and calibrated model evidence all agree.</p></div><Target className="h-5 w-5 shrink-0 text-accent/70" /></div>
          <button type="button" onClick={() => void analyzeFullGame(selectedEvent)} disabled={fullAnalysis?.state === "loading" || availableMarkets === 0} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-45" style={{ background: "linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))", boxShadow: "0 4px 18px -4px hsla(250,76%,62%,0.42)" }}>
            {fullAnalysis?.state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Analyze Full Game
          </button>
        </div>

        <MarketCard snapshot={snapshots.h2h} title="Moneyline" analysis={marketAnalysesForEvent.h2h} onAnalyze={() => void analyzeSingleMarket(selectedEvent, "h2h")} marketFeedUnavailable={marketFeedUnavailable} />
        <MarketCard snapshot={snapshots.spreads} title="Spread" analysis={marketAnalysesForEvent.spreads} onAnalyze={() => void analyzeSingleMarket(selectedEvent, "spreads")} marketFeedUnavailable={marketFeedUnavailable} />
        <MarketCard snapshot={snapshots.totals} title="Game Total" analysis={marketAnalysesForEvent.totals} onAnalyze={() => void analyzeSingleMarket(selectedEvent, "totals")} marketFeedUnavailable={marketFeedUnavailable} />
        <GameAnalysisExperience experience={analysisExperience} onClose={() => setAnalysisExperience(null)} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="vision-card relative overflow-hidden p-4">
        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-15 blur-2xl" style={{ background: "hsl(250 76% 62%)" }} />
        <div className="relative flex items-start justify-between gap-3"><div><p className="text-[8px] font-bold uppercase tracking-[0.15em] text-accent/75">Live Game Lines</p><h2 className="mt-1 text-base font-extrabold text-foreground">Upcoming {sport.toUpperCase()} matchups</h2><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/65">Published sportsbook odds only. Open a game to compare markets or run a verified analysis.</p></div><button type="button" onClick={() => void loadEvents()} disabled={loading} className="rounded-lg p-2 text-muted-foreground/65 transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-40" aria-label="Refresh live game lines"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button></div>
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
          <div className="flex items-center gap-2 px-1"><CalendarDays className="h-3.5 w-3.5 text-accent/75" /><h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/80">{dateLabel(group.date)}</h3><span className="text-[9px] text-muted-foreground/45">{group.games.length} game{group.games.length === 1 ? "" : "s"}</span></div>
          {group.games.map((event, index) => {
            const teams = resolveEventTeams(event, teamDirectory);
            const availableMarketCount = (["h2h", "spreads", "totals"] as MarketKey[]).filter((market) => getMarketSnapshot(event, market)).length;
            return (
              <motion.article key={event.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="vision-card overflow-hidden">
                <div className="p-4"><div className="flex items-center justify-between gap-3 text-[8px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55"><span>{event.sport_title || sport.toUpperCase()}</span><span>{gameTimeLabel(event.commence_time)}</span></div><div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div className="flex min-w-0 items-center gap-2"><TeamBadge team={teams?.away} fallbackName={event.away_team} /><span className="min-w-0 truncate text-[12px] font-bold text-foreground">{event.away_team}</span></div><span className="text-[10px] font-black text-accent/75">VS</span><div className="flex min-w-0 items-center justify-end gap-2 text-right"><span className="min-w-0 truncate text-[12px] font-bold text-foreground">{event.home_team}</span><TeamBadge team={teams?.home} fallbackName={event.home_team} /></div></div><div className="mt-3 flex items-center gap-1.5 text-[9px] text-muted-foreground/60"><BarChart3 className="h-3.5 w-3.5 text-nba-green" />{availableMarketCount > 0 ? `${availableMarketCount} live market${availableMarketCount === 1 ? "" : "s"} available` : marketFeedUnavailable ? "Live odds temporarily unavailable" : "No verified markets currently returned"}{!teams && <span className="ml-auto text-nba-yellow">Team verification pending</span>}</div></div>
                <div className="grid grid-cols-2 gap-px border-t border-border/30 bg-border/30"><button type="button" onClick={() => setSelectedEvent(event)} className="flex items-center justify-center gap-1.5 bg-card py-3 text-[11px] font-bold text-foreground/85 transition-colors hover:bg-accent/10 hover:text-accent">View Lines <ChevronRight className="h-3.5 w-3.5" /></button><button type="button" onClick={() => { setSelectedEvent(event); void analyzeFullGame(event); }} disabled={!teams || availableMarketCount === 0} className="flex items-center justify-center gap-1.5 bg-card py-3 text-[11px] font-bold text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />Analyze</button></div>
              </motion.article>
            );
          })}
        </div>
      ))}

      {!loading && visibleDateCount < groupedEvents.length && <button type="button" onClick={() => setVisibleDateCount((current) => current + INITIAL_DATE_COUNT)} className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-bold text-accent transition-colors hover:bg-accent/10" style={{ border: "1px solid hsla(250,76%,62%,0.2)", background: "hsla(250,76%,62%,0.06)" }}>Show next dates <ChevronRight className="h-3.5 w-3.5" /></button>}
    </section>
  );
}
