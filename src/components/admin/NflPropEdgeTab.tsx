import React, { useEffect, useState } from "react";
import {
  Controls,
  Notice,
  PerfTable,
  StatCards,
  num,
  pct,
  useNflSummary,
  useNflVersions,
  type Perf,
  type RangePreset,
} from "./nfl/NflAnalyticsParts";

/** NFL PLAYER PROP EDGE analytics — props only. Never shows game-edge metrics. */

interface PropSummary {
  forward_test?: { promotion_rule: string; overall: Perf; by_prop_type: Record<string, Perf>; by_position: Record<string, Perf> };
  overall: Perf;
  projection_accuracy: { graded_rows: number; mae: number | null; rmse: number | null };
  by_position: Record<string, Perf>;
  by_prop_type: Record<string, Perf>;
  by_edge_bucket: Record<string, Perf>;
  by_confidence_bucket: Record<string, Perf>;
  backtest: {
    seasons: string;
    market_source: string;
    metrics: {
      by_prop_type?: Record<string, { n: number; mae: number; rmse: number; bias: number; pit_ece: number; over_ece_proxy_line: number | null }>;
    };
  } | null;
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K"];

function Backtest({ bt }: { bt: PropSummary["backtest"] }) {
  if (!bt?.metrics.by_prop_type) {
    return <Notice>No prop backtest run recorded for this version. Run <code>node scripts/nfl/backtest-prop.ts --upload</code>.</Notice>;
  }
  const rows = Object.entries(bt.metrics.by_prop_type);
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-x-auto">
      <p className="px-3 pt-2.5 text-xs font-semibold text-foreground">
        Historical projection backtest · {bt.seasons} · {bt.market_source}
      </p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground text-left">
            {["Prop type", "n", "MAE", "RMSE", "Bias", "PIT ECE", "Over ECE (proxy line)"].map((h) => <th key={h} className="px-3 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, r]) => (
            <tr key={k} className="border-t border-border/30">
              <td className="px-3 py-1.5 font-semibold text-foreground">{k}</td>
              <td className="px-3 py-1.5">{r.n}</td>
              <td className="px-3 py-1.5">{num(r.mae, 2)}</td>
              <td className="px-3 py-1.5">{num(r.rmse, 2)}</td>
              <td className="px-3 py-1.5">{num(r.bias, 2)}</td>
              <td className={`px-3 py-1.5 ${r.pit_ece > 0.08 ? "text-amber-400" : ""}`}>{num(r.pit_ece, 3)}</td>
              <td className="px-3 py-1.5">{num(r.over_ece_proxy_line, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        No historical prop prices exist, so hit rate / ROI / CLV below come from graded live predictions only.
      </p>
    </div>
  );
}

function Summary({ data, label }: { data: PropSummary; label?: string }) {
  return (
    <div className="space-y-3">
      {data.forward_test && (
        <div className="space-y-2">
          <Notice>Forward test (shadow picks — never shown to users). Promotion: {data.forward_test.promotion_rule}.</Notice>
          <PerfTable title="Forward test by position" rows={data.forward_test.by_position} order={POSITIONS} />
          <PerfTable title="Forward test by prop type" rows={data.forward_test.by_prop_type} />
        </div>
      )}
      <StatCards perf={data.overall} label={label ? `${label} — published PLAYs` : "Published PLAYs"} />
      <div className="grid grid-cols-3 gap-2">
        {([
          ["Graded rows", String(data.projection_accuracy.graded_rows)],
          ["Projection MAE", num(data.projection_accuracy.mae, 2)],
          ["Projection RMSE", num(data.projection_accuracy.rmse, 2)],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border/40 bg-card/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="text-sm font-bold text-foreground tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <PerfTable title="By position" rows={data.by_position} order={POSITIONS} />
      <PerfTable title="By prop type" rows={data.by_prop_type} />
      <div className="grid gap-3 md:grid-cols-2">
        <PerfTable title="By edge bucket (PLAYs)" rows={data.by_edge_bucket} order={["3-5%", "5-8%", "8%+"]} />
        <PerfTable title="By confidence bucket (PLAYs)" rows={data.by_confidence_bucket} order={["60-65", "65-70", "70+"]} />
      </div>
      <Backtest bt={data.backtest} />
      <p className="text-[11px] text-muted-foreground">Hit rate = win % of graded PLAYs; {pct(data.overall.clv_coverage)} of PLAYs have a same-line closing price for CLV.</p>
    </div>
  );
}

export const NflPropEdgeTab: React.FC<{ password: string }> = ({ password }) => {
  const versions = useNflVersions(password, "player_prop_edge");
  const [version, setVersion] = useState("");
  const [compare, setCompare] = useState("");
  const [preset, setPreset] = useState<RangePreset>("season");
  useEffect(() => { if (!version && versions.length) setVersion(versions[versions.length - 1]); }, [versions, version]);
  const a = useNflSummary<PropSummary>(password, "prop_summary", version, preset);
  const b = useNflSummary<PropSummary>(password, "prop_summary", compare, preset);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-foreground">NFL Player Prop Edge</h2>
        <p className="text-xs text-muted-foreground">QB, RB, WR, TE and K props only. Game markets are tracked separately.</p>
      </div>
      <Controls
        versions={versions}
        version={version}
        compare={compare}
        preset={preset}
        loading={a.loading || b.loading}
        onVersion={setVersion}
        onCompare={setCompare}
        onPreset={setPreset}
        onRefresh={() => { void a.reload(); void b.reload(); }}
      />
      {a.error && <Notice>{a.error}</Notice>}
      {!version && <Notice>No NFL player-prop predictions or backtests yet.</Notice>}
      <div className={compare ? "grid gap-4 xl:grid-cols-2" : ""}>
        {a.data && <Summary data={a.data} label={version} />}
        {compare && b.data && <Summary data={b.data} label={compare} />}
      </div>
    </div>
  );
};
