import { normalizeConfidencePercent, normalizeVerdict, type CanonicalVerdict } from "@/lib/matchupGrade";

export type SavedPickSport = "nba" | "mlb" | "nhl" | "ufc" | "nfl";

export interface SavedDailyPickRow {
  id?: string;
  player_name?: string | null;
  prop_type?: string | null;
  line?: number | string | null;
  direction?: string | null;
  hit_rate?: number | null;
  confidence?: number | null;
  verdict?: string | null;
  odds?: string | null;
  tier?: string | null;
  team?: string | null;
  opponent?: string | null;
  reasoning?: string | null;
  sport?: string | null;
  model_diagnostics?: Record<string, unknown> | null;
  player_image_url?: string | null;
  metadata?: Record<string, unknown> | null;
  avg_value?: number | string | null;
}

export interface SavedPickSnapshot {
  confidence?: number | null;
  verdict?: string | null;
  hit_rate?: number | null;
  confidenceSource?: string | null;
  sourceContractVersion?: string | null;
  reasoning?: string | null;
  avg_value?: number | null;
  odds?: string | null;
  tier?: string | null;
  team?: string | null;
  opponent?: string | null;
  prop_type?: string | null;
  line?: number | string | null;
  direction?: string | null;
  model_diagnostics?: Record<string, unknown> | null;
}

export interface SavedPickNavState {
  daily_picks_id?: string | null;
  entrySource?: "todays_edge" | "picks" | "direct" | string;
  sport?: string | null;
  player?: string | null;
  prop_type?: string | null;
  line?: number | string | null;
  over_under?: string | null;
  opponent?: string | null;
  pick_snapshot?: SavedPickSnapshot | null;
}

export interface SavedPickMarket {
  bestBook: string | null;
  bookCount: number | null;
  consensusLine: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  marketDepth: string | null;
  marketDataQuality: string | null;
  juicePenalty: number | null;
  eventHomeTeam: string | null;
  eventAwayTeam: string | null;
  scannerConfidencePercent: number | null;
  analyzerConfidencePercent: number | null;
  analyzerAgreement: string | null;
  evPct: number | null;
  modelEdge: number | null;
  edgeDowngradeReason: string | null;
}

export interface CanonicalSavedPick {
  ready: true;
  source: "saved_daily_pick";
  daily_picks_id: string | null;
  sport: SavedPickSport;
  player_name: string;
  prop_type: string;
  direction: "over" | "under";
  line: number;
  confidence: number;
  verdict: CanonicalVerdict;
  hit_rate: number | null;
  edge: number | null;
  odds: string | null;
  tier: string | null;
  team: string | null;
  opponent: string | null;
  reasoning: string | null;
  model_diagnostics: Record<string, unknown> | null;
  player_image_url: string | null;
  market: SavedPickMarket;
  avg_value: number | null;
}

const SUPPORTED_SPORTS: ReadonlyArray<SavedPickSport> = ["nba", "mlb", "nhl", "ufc", "nfl"];

function toSport(input: unknown): SavedPickSport {
  const s = String(input ?? "").toLowerCase().trim();
  return (SUPPORTED_SPORTS.includes(s as SavedPickSport) ? s : "nba") as SavedPickSport;
}

function toDirection(input: unknown): "over" | "under" {
  const s = String(input ?? "").toLowerCase().trim();
  return s === "under" ? "under" : "over";
}

function toNumberOrNull(input: unknown): number | null {
  if (input == null || input === "") return null;
  const n = typeof input === "number" ? input : parseFloat(String(input));
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(input: unknown): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  return s ? s : null;
}

function pickMarketDiagnostics(
  diag: Record<string, unknown> | null | undefined,
): SavedPickMarket {
  const d = diag ?? {};
  return {
    bestBook: toStringOrNull(d.bestBook),
    bookCount: toNumberOrNull(d.bookCount),
    consensusLine: toNumberOrNull(d.consensusLine),
    oddsAmerican: toNumberOrNull(d.oddsAmerican),
    impliedProbability: toNumberOrNull(d.impliedProbability),
    marketDepth: toStringOrNull(d.marketDepth),
    marketDataQuality: toStringOrNull(d.marketDataQuality),
    juicePenalty: toNumberOrNull(d.juicePenalty),
    eventHomeTeam: toStringOrNull(d.eventHomeTeam),
    eventAwayTeam: toStringOrNull(d.eventAwayTeam),
    scannerConfidencePercent: toNumberOrNull(d.scanner_confidence_percent ?? d.scannerConfidence),
    analyzerConfidencePercent: toNumberOrNull(d.analyzer_confidence_percent ?? d.analyzerConfidence),
    analyzerAgreement: toStringOrNull(d.analyzerAgreement),
    evPct: toNumberOrNull(d.evPct),
    modelEdge: toNumberOrNull(d.modelEdge),
    edgeDowngradeReason: toStringOrNull(d.edgeDowngradeReason),
  };
}

/**
 * Returns true when the nav state carries enough signal to treat this as a
 * saved-pick detail open (vs. a fresh manual analysis request).
 */
export function isSavedPickPayload(navState: SavedPickNavState | null | undefined): boolean {
  if (!navState) return false;
  if (navState.daily_picks_id) return true;
  const snap = navState.pick_snapshot;
  if (!snap) return false;
  return snap.confidence != null || snap.verdict != null || snap.hit_rate != null;
}

/**
 * Builds the canonical view for a saved pick from any combination of:
 *  - a fresh `daily_picks` row (preferred when fetched live),
 *  - the click-time `pick_snapshot` carried in nav state,
 *  - the surrounding nav state (player/prop/line/direction).
 *
 * Returns null only when there's no usable confidence/verdict pair AND no
 * row to derive one from.
 */
export function mapSavedPickToView(input: {
  row?: SavedDailyPickRow | null;
  snapshot?: SavedPickSnapshot | null;
  navState?: SavedPickNavState | null;
}): CanonicalSavedPick | null {
  const row = input.row ?? null;
  const snap = input.snapshot ?? input.navState?.pick_snapshot ?? null;
  const nav = input.navState ?? null;

  const rawConf = row?.confidence ?? row?.hit_rate ?? snap?.confidence ?? snap?.hit_rate;
  if (rawConf == null) return null;
  const confidence = Math.round(normalizeConfidencePercent(rawConf));

  const verdict = normalizeVerdict(row?.verdict ?? snap?.verdict, confidence);

  const player_name = String(row?.player_name ?? nav?.player ?? "").trim();
  const prop_type = String(row?.prop_type ?? snap?.prop_type ?? nav?.prop_type ?? "").trim();
  const direction = toDirection(row?.direction ?? snap?.direction ?? nav?.over_under);
  const line = toNumberOrNull(row?.line ?? snap?.line ?? nav?.line) ?? 0;

  const hit_rate = toNumberOrNull(row?.hit_rate ?? snap?.hit_rate);
  const diagnostics: Record<string, unknown> | null =
    (row?.model_diagnostics ?? snap?.model_diagnostics ?? null) as Record<string, unknown> | null;
  const edgeRaw = diagnostics ? (diagnostics as Record<string, unknown>)["edge"] : null;
  const edge = toNumberOrNull(edgeRaw);
  const market = pickMarketDiagnostics(diagnostics);
  const avg_value = toNumberOrNull(row?.avg_value ?? null);

  return {
    ready: true,
    source: "saved_daily_pick",
    daily_picks_id: nav?.daily_picks_id ?? row?.id ?? null,
    sport: toSport(row?.sport ?? nav?.sport),
    player_name,
    prop_type,
    direction,
    line,
    confidence,
    verdict,
    hit_rate,
    edge,
    odds: row?.odds ?? snap?.odds ?? null,
    tier: row?.tier ?? snap?.tier ?? null,
    team: row?.team ?? snap?.team ?? null,
    opponent: row?.opponent ?? snap?.opponent ?? nav?.opponent ?? null,
    reasoning: row?.reasoning ?? snap?.reasoning ?? null,
    model_diagnostics: diagnostics,
    player_image_url: row?.player_image_url ?? null,
    market,
    avg_value,
  };
}
