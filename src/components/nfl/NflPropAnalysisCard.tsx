import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, ChevronDown, Gauge, Target, UserRound } from "lucide-react";

/**
 * Result card for the NFL Player Prop analyzer (nfl-player-prop-edge, one
 * prop on demand). Renders the NFL model's own output — projection,
 * distribution, probabilities vs the line, market edge and the 33 factors.
 *
 * Only a result with status "PLAY" is presented as a pick; that requires the
 * prop type to be proven profitable in forward testing. Everything else is
 * clearly labelled as model analysis in forward testing.
 */

export const NFL_PROP_LABELS: Record<string, string> = {
  pass_yds: "Passing Yards", pass_att: "Pass Attempts", pass_cmp: "Completions", pass_tds: "Passing TDs",
  pass_ints: "Interceptions", rush_yds: "Rushing Yards", rush_att: "Rush Attempts", rec_yds: "Receiving Yards",
  receptions: "Receptions", targets: "Targets", anytime_td: "Anytime TD", fg_made: "Field Goals Made",
  xp_made: "Extra Points", kicking_points: "Kicking Points",
};

interface Factor {
  id: number;
  name: string;
  value: number | string | null;
  effect: number | null;
  source: string;
  proxy: boolean;
  missing: boolean;
}

interface SideResult {
  side: "over" | "under";
  line: number;
  market_price: number | null;
  market_book: string | null;
  projection: number;
  median_projection: number;
  std_dev: number;
  p10: number;
  p90: number;
  distribution: string;
  over_probability: number;
  under_probability: number;
  push_probability: number;
  model_probability: number;
  no_vig_probability: number | null;
  fair_price: number | null;
  edge_percentage: number | null;
  expected_value: number | null;
  confidence: number;
  expected_snap_percentage: number;
  injury_status: string | null;
  role_projection: {
    expected_snaps: number;
    route_participation: number;
    route_proxy: boolean;
    targets: number;
    carries: number;
    pass_attempts: number;
    team_plays: number;
    team_pass_rate: number;
  };
  status: "PLAY" | "NO PLAY";
  no_play_reasons: string[];
  data_quality: number;
  factors: Factor[];
}

export interface NflPropAnalysis {
  _isNfl: true;
  model_version: string;
  player: { name: string; team: string; position: string };
  game: { home: string; away: string; kickoff: string | null; opponent: string };
  prop_type: string;
  line: number;
  requested_side: "over" | "under";
  market_source: "odds_snapshots" | "caller_supplied" | "none";
  sportsbook_line: { line: number; over_price: number | null; under_price: number | null } | null;
  proven: boolean;
  forward_test: string;
  results: SideResult[];
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const price = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v > 0 ? `+${v}` : `${v}`);
const signed = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const cleanReason = (r: string) => r.replace(/^unproven:\s*/, "");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "hsla(228,24%,12%,0.7)", border: "1px solid hsla(228,30%,22%,0.35)" }}>
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">{label}</p>
      <p className="mt-1 text-[17px] font-black tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

export function NflPropAnalysisCard({ data }: { data: NflPropAnalysis }) {
  const [showFactors, setShowFactors] = useState(false);
  const chosen = data.results.find((r) => r.side === data.requested_side) ?? data.results[0];
  if (!chosen) return null;
  const other = data.results.find((r) => r.side !== chosen.side);
  const isPick = chosen.status === "PLAY";
  const label = NFL_PROP_LABELS[data.prop_type] ?? data.prop_type;
  const sideLabel = data.prop_type === "anytime_td" ? (chosen.side === "over" ? "Yes" : "No") : chosen.side === "over" ? "Over" : "Under";
  const kickoff = data.game.kickoff
    ? new Date(data.game.kickoff).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const role = chosen.role_projection;
  const reasons = chosen.no_play_reasons.map(cleanReason);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
      {/* Header */}
      <div className="vision-card p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: "hsla(214,100%,20%,0.5)", border: "1px solid hsla(214,80%,40%,0.35)" }}>
            <UserRound className="h-5 w-5 text-foreground/80" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-extrabold text-foreground">{data.player.name}</p>
            <p className="text-[11px] text-muted-foreground/65">
              {data.player.position} · {data.player.team} vs {data.game.opponent}{kickoff ? ` · ${kickoff}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
          <p className="text-[13px] font-bold text-foreground">
            {sideLabel} {data.prop_type === "anytime_td" ? "" : data.line} {label}
          </p>
          {isPick ? (
            <span className="flex items-center gap-1 rounded-lg bg-nba-green/15 px-2 py-1 text-[10px] font-black text-nba-green"><BadgeCheck className="h-3.5 w-3.5" /> PLAY</span>
          ) : (
            <span className="rounded-lg px-2 py-1 text-[10px] font-bold text-nba-yellow" style={{ background: "hsla(42,92%,55%,0.1)" }}>NOT A PICK</span>
          )}
        </div>
      </div>

      {!isPick && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed text-nba-yellow" style={{ background: "hsla(42,92%,55%,0.07)", border: "1px solid hsla(42,92%,55%,0.18)" }}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Model analysis only. NFL {label.toLowerCase()} is in forward testing ({data.forward_test}) — it becomes a pick only after the model proves profitable on graded results.
          </span>
        </div>
      )}

      {/* Projection */}
      <div className="vision-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" />
          <h3 className="text-[14px] font-extrabold text-foreground">NFL model projection</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Projection" value={data.prop_type === "anytime_td" ? pct(chosen.over_probability, 0) : chosen.projection.toFixed(1)} sub={data.prop_type === "anytime_td" ? "chance to score" : `median ${chosen.median_projection}`} />
          <Stat label="Range" value={data.prop_type === "anytime_td" ? "—" : `${chosen.p10}–${chosen.p90}`} sub="10th–90th pct" />
          <Stat label="Confidence" value={chosen.confidence.toFixed(0)} sub="prop confidence" />
        </div>

        {/* Over / under probability */}
        <div className="mt-3 space-y-2">
          {(["over", "under"] as const).map((side) => {
            const p = side === "over" ? chosen.over_probability : chosen.under_probability;
            const active = side === chosen.side;
            return (
              <div key={side}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className={active ? "font-bold text-foreground" : "text-muted-foreground/70"}>
                    {data.prop_type === "anytime_td" ? (side === "over" ? "Scores" : "Doesn't score") : `${side === "over" ? "Over" : "Under"} ${data.line}`}
                  </span>
                  <span className={`tabular-nums ${active ? "font-bold text-foreground" : "text-muted-foreground/70"}`}>{pct(p)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={`h-full rounded-full ${active ? "bg-accent" : "bg-white/20"}`} style={{ width: `${Math.min(100, p * 100)}%` }} />
                </div>
              </div>
            );
          })}
          {chosen.push_probability > 0 && <p className="text-[10px] text-muted-foreground/55">Push (exactly {data.line}): {pct(chosen.push_probability)}</p>}
          <p className="text-[10px] text-muted-foreground/50">Distribution: {chosen.distribution.replace(/_/g, " ")}</p>
        </div>
      </div>

      {/* Market */}
      <div className="vision-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-accent" />
          <h3 className="text-[14px] font-extrabold text-foreground">Versus the sportsbook</h3>
        </div>
        {chosen.market_price !== null ? (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Price" value={price(chosen.market_price)} sub={chosen.market_book ?? "best available"} />
            <Stat label="Model" value={pct(chosen.model_probability)} sub={`fair ${price(chosen.fair_price)}`} />
            <Stat label="No-vig market" value={pct(chosen.no_vig_probability)} />
            <Stat label="Edge / EV" value={signed(chosen.edge_percentage)} sub={`EV ${signed(chosen.expected_value)}`} />
          </div>
        ) : (
          <div className="space-y-2 text-[11px] text-muted-foreground/70">
            <p>No sportsbook price found for {sideLabel.toLowerCase()} {data.line} — edge can't be measured without a real price.</p>
            {data.sportsbook_line && (
              <p className="font-semibold text-foreground/85">
                Book line: {data.sportsbook_line.line} (O {price(data.sportsbook_line.over_price)} / U {price(data.sportsbook_line.under_price)}). Re-run at that line to compare.
              </p>
            )}
            <p>Model probability: <span className="font-bold text-foreground">{pct(chosen.model_probability)}</span> · fair price {price(chosen.fair_price)}</p>
          </div>
        )}
      </div>

      {/* Role */}
      <div className="vision-card p-4">
        <h3 className="mb-3 text-[14px] font-extrabold text-foreground">Projected role</h3>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Snap share" value={pct(chosen.expected_snap_percentage, 0)} sub={`${role.expected_snaps.toFixed(0)} snaps`} />
          {data.player.position === "QB" ? (
            <Stat label="Pass att" value={role.pass_attempts.toFixed(1)} />
          ) : data.player.position === "K" ? (
            <Stat label="Team plays" value={role.team_plays.toFixed(0)} />
          ) : (
            <Stat label="Targets" value={role.targets.toFixed(1)} sub={role.route_proxy ? "routes est." : undefined} />
          )}
          <Stat label="Carries" value={role.carries.toFixed(1)} sub={`pass rate ${pct(role.team_pass_rate, 0)}`} />
        </div>
        {chosen.injury_status && <p className="mt-2 text-[11px] font-semibold text-nba-yellow">Injury report: {chosen.injury_status}</p>}
      </div>

      {/* Factors */}
      <div className="vision-card overflow-hidden">
        <button type="button" onClick={() => setShowFactors((v) => !v)} className="flex w-full items-center justify-between p-4 text-left">
          <span className="text-[14px] font-extrabold text-foreground">All {chosen.factors.length} model factors</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showFactors ? "rotate-180" : ""}`} />
        </button>
        {showFactors && (
          <div className="divide-y divide-white/[0.05] px-4 pb-3">
            {chosen.factors.map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground/90">{f.id}. {f.name}</p>
                  <p className="text-[10px] text-muted-foreground/55">{f.source}{f.proxy ? " · proxy" : ""}{f.missing ? " · missing" : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] tabular-nums text-foreground/85">{f.value === null ? "—" : String(f.value)}</p>
                  {f.effect !== null && <p className={`text-[10px] tabular-nums ${f.effect > 1.005 ? "text-nba-green" : f.effect < 0.995 ? "text-nba-red" : "text-muted-foreground/50"}`}>×{f.effect.toFixed(3)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isPick && reasons.length > 0 && (
        <div className="vision-card p-4">
          <h3 className="mb-2 text-[13px] font-extrabold text-foreground">Why it's not a pick</h3>
          <ul className="space-y-1 text-[11px] text-muted-foreground/75">
            {reasons.map((r) => <li key={r}>• {r}</li>)}
          </ul>
          {other && <p className="mt-2 text-[10px] text-muted-foreground/50">Other side ({other.side}): model {pct(other.model_probability)}{other.edge_percentage !== null ? `, edge ${signed(other.edge_percentage)}` : ""}.</p>}
        </div>
      )}

      <p className="px-1 text-[9px] text-muted-foreground/45">Model {data.model_version} · data quality {pct(chosen.data_quality, 0)}</p>
    </motion.div>
  );
}
