import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { fetchNflGameEdge, fetchNflPlayerPropEdge } from "@/services/api";

/**
 * NFL — two independent products on one page:
 *   Game Edge   (moneyline / spread / total)   ← nfl-game-edge
 *   Player Props                                ← nfl-player-prop-edge
 * Each tab loads only its own engine's predictions; numbers are never merged.
 * Every probability is labelled as coming from an unvalidated model, and
 * NO PLAY is shown as NO PLAY — nothing is padded to fill the slate.
 */

type Tab = "game" | "props";

interface GamePrediction {
  game_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  market_type: "moneyline" | "spread" | "total";
  selection: string;
  model_probability: number;
  no_vig_probability: number | null;
  market_price: number | null;
  fair_price: number | null;
  edge_percentage: number | null;
  expected_value: number | null;
  confidence: number;
  projected_score: { home_team: string; home: number; away_team: string; away: number } | null;
  status: "PLAY" | "NO PLAY";
  no_play_reasons: string[];
}

interface PropPrediction {
  game_id: string;
  player_name: string;
  team: string;
  opponent: string | null;
  position: string;
  prop_type: string;
  side: "over" | "under";
  line: number;
  projection: number;
  median_projection: number;
  p10: number | null;
  p90: number | null;
  model_probability: number;
  no_vig_probability: number | null;
  market_price: number | null;
  edge_percentage: number | null;
  expected_value: number | null;
  confidence: number;
  status: "PLAY" | "NO PLAY";
  no_play_reasons: string[];
  commence_time: string;
}

const PROP_LABEL: Record<string, string> = {
  pass_yds: "Pass Yds", pass_att: "Pass Att", pass_cmp: "Completions", pass_tds: "Pass TDs", pass_ints: "INTs",
  rush_yds: "Rush Yds", rush_att: "Rush Att", rec_yds: "Rec Yds", receptions: "Receptions", targets: "Targets",
  anytime_td: "Anytime TD", fg_made: "FG Made", xp_made: "XP Made", kicking_points: "Kicking Pts",
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const signed = (v: number | null | undefined, suffix = "%") =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${suffix}`;
const price = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v > 0 ? `+${v}` : `${v}`);
const kickoff = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

function ForwardTestBanner() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>Proven picks only.</strong> NFL picks appear here only for markets whose model has proven profitable on
        graded results. Markets still in forward testing show no picks.
      </span>
    </div>
  );
}

function StatusChip({ status }: { status: "PLAY" | "NO PLAY" }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
        status === "PLAY" ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function GameEdgeList({ rows }: { rows: GamePrediction[] }) {
  const games = useMemo(() => {
    const m = new Map<string, GamePrediction[]>();
    for (const r of rows) m.set(r.game_id, [...(m.get(r.game_id) ?? []), r]);
    return [...m.values()].sort((a, b) => a[0].commence_time.localeCompare(b[0].commence_time));
  }, [rows]);
  if (!games.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No NFL game picks. Moneyline, spread and total models are still in forward testing — picks unlock only once a market proves profitable.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {games.map((list) => {
        const g = list[0];
        // One card per market: show the side the model prefers (higher edge).
        const best = (["moneyline", "spread", "total"] as const)
          .map((m) => list.filter((r) => r.market_type === m).sort((a, b) => (b.edge_percentage ?? -99) - (a.edge_percentage ?? -99))[0])
          .filter((r): r is GamePrediction => !!r);
        return (
          <div key={g.game_id} className="rounded-2xl border border-border/40 bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground">{g.away_team} @ {g.home_team}</p>
              <p className="text-[11px] text-muted-foreground">{kickoff(g.commence_time)}</p>
            </div>
            {g.projected_score && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                Model score: {g.projected_score.away_team} {g.projected_score.away} – {g.projected_score.home_team} {g.projected_score.home}
              </p>
            )}
            <div className="space-y-2">
              {best.map((r) => (
                <div key={r.market_type} className="rounded-xl bg-background/40 p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      <span className="mr-1.5 text-[10px] uppercase text-muted-foreground">{r.market_type}</span>
                      {r.selection}
                    </p>
                    <StatusChip status={r.status} />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Metric label="Model" value={pct(r.model_probability)} />
                    <Metric label="No-vig" value={pct(r.no_vig_probability)} />
                    <Metric label="Edge" value={signed(r.edge_percentage)} />
                    <Metric label="Price" value={price(r.market_price)} />
                  </div>
                  {r.status === "NO PLAY" && r.no_play_reasons[0] && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">Why no play: {r.no_play_reasons[0]}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PropList({ rows }: { rows: PropPrediction[] }) {
  // The endpoint returns published (proven) PLAYs only; the filter below is a safeguard.
  const [pos, setPos] = useState<string>("ALL");
  const shown = useMemo(() => {
    // One row per player/prop: the side with the larger edge.
    const m = new Map<string, PropPrediction>();
    for (const r of rows) {
      const k = `${r.game_id}|${r.player_name}|${r.prop_type}`;
      const prev = m.get(k);
      if (!prev || (r.edge_percentage ?? -99) > (prev.edge_percentage ?? -99)) m.set(k, r);
    }
    return [...m.values()]
      .filter((r) => r.status === "PLAY")
      .filter((r) => (pos === "ALL" ? true : r.position === pos))
      .sort((a, b) => (b.edge_percentage ?? -99) - (a.edge_percentage ?? -99));
  }, [rows, pos]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {["ALL", "QB", "RB", "WR", "TE", "K"].map((p) => (
          <button
            key={p}
            onClick={() => setPos(p)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${pos === p ? "bg-primary text-primary-foreground" : "bg-card/60 text-muted-foreground"}`}
          >
            {p}
          </button>
        ))}
      </div>
      {!shown.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No NFL prop picks. Prop models are in forward testing — picks unlock per prop type once proven profitable.
        </p>
      )}
      {shown.map((r) => (
        <div key={`${r.game_id}|${r.player_name}|${r.prop_type}`} className="rounded-2xl border border-border/40 bg-card/60 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">{r.player_name}</p>
              <p className="text-[11px] text-muted-foreground">{r.position} · {r.team}{r.opponent ? ` vs ${r.opponent}` : ""} · {kickoff(r.commence_time)}</p>
            </div>
            <StatusChip status={r.status} />
          </div>
          <p className="mb-2 text-xs font-semibold text-foreground">
            {r.side === "over" ? "Over" : "Under"} {r.line} {PROP_LABEL[r.prop_type] ?? r.prop_type}
          </p>
          <div className="grid grid-cols-4 gap-2">
            <Metric label="Projection" value={r.projection.toFixed(1)} />
            <Metric label="Median" value={String(r.median_projection)} />
            <Metric label="Model" value={pct(r.model_probability)} />
            <Metric label="Edge" value={signed(r.edge_percentage)} />
            <Metric label="Range" value={r.p10 !== null && r.p90 !== null ? `${r.p10}–${r.p90}` : "—"} />
            <Metric label="No-vig" value={pct(r.no_vig_probability)} />
            <Metric label="Price" value={price(r.market_price)} />
            <Metric label="Conf" value={r.confidence.toFixed(0)} />
          </div>
          {r.status === "NO PLAY" && r.no_play_reasons[0] && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">Why no play: {r.no_play_reasons[0]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function NflEdgePage() {
  const [tab, setTab] = useState<Tab>("game");
  const [games, setGames] = useState<GamePrediction[]>([]);
  const [props, setProps] = useState<PropPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (which: Tab) => {
    setLoading(true);
    setError(null);
    try {
      if (which === "game") {
        const res = await fetchNflGameEdge({ action: "list", days: 7 });
        setGames((res?.predictions ?? []) as GamePrediction[]);
      } else {
        const res = await fetchNflPlayerPropEdge({ action: "list", days: 7 });
        setProps((res?.predictions ?? []) as PropPrediction[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load NFL predictions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(tab); }, [tab]);

  return (
    <div className="mx-auto w-full max-w-[430px] space-y-3 px-4 pb-24 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">NFL</h1>
        <button onClick={() => void load(tab)} className="text-muted-foreground" aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/40 bg-card/60 p-1">
        {([["game", "Game Edge"], ["props", "Player Props"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg py-2 text-sm font-semibold ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <ForwardTestBanner />
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {tab === "game" ? <GameEdgeList rows={games} /> : <PropList rows={props} />}
    </div>
  );
}

/**
 * Self-contained NFL player-prop panel (proven picks only) for embedding in the
 * Analyze screen. Loads only the prop engine — never the game engine.
 */
export function NflPropPicksPanel() {
  const [rows, setRows] = useState<PropPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNflPlayerPropEdge({ action: "list", days: 7 });
      setRows((res?.predictions ?? []) as PropPrediction[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load NFL props");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">NFL player props</p>
        <button onClick={() => void load()} className="text-muted-foreground" aria-label="Refresh NFL props">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <ForwardTestBanner />
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {!loading && <PropList rows={rows} />}
    </div>
  );
}
