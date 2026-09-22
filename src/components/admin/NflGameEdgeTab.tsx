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

/** NFL GAME EDGE analytics — ML / spread / totals only. Never shows prop metrics. */

interface GameSummary {
  forward_test?: { promotion_rule: string; overall: Perf; by_market: Record<string, Perf> };
  overall: Perf;
  by_market: Record<string, Perf>;
  by_edge_bucket: Record<string, Perf>;
  by_confidence_bucket: Record<string, Perf>;
  backtest: {
    model_version: string;
    seasons: string;
    market_source: string;
    created_at: string;
    metrics: {
      moneyline?: { games: number; accuracy: number; brier: number; log_loss: number; market_brier: number; market_log_loss: number; calibration?: { ece: number }; gated_bets?: { bets: number; record: string; roi: number | null } };
      spread?: { games: number; brier: number; margin_mae: number; calibration?: { ece: number }; ats_all_games?: { record: string; roi: number | null }; gated_bets?: { bets: number; record: string; roi: number | null } };
      total?: { games: number; brier: number; total_mae: number; calibration?: { ece: number }; ou_all_games?: { record: string; roi: number | null }; gated_bets?: { bets: number; record: string; roi: number | null } };
      evidence_gates?: Record<string, { min_edge: number; bets: number; roi: number } | null>;
    };
  } | null;
}

const MARKET_ORDER = ["moneyline", "spread", "total"];

function Backtest({ bt }: { bt: GameSummary["backtest"] }) {
  if (!bt) return <Notice>No game backtest run recorded for this version. Run <code>node scripts/nfl/backtest-game.ts --upload</code>.</Notice>;
  const m = bt.metrics;
  const rows: Array<[string, string, string, string, string]> = [
    ["Moneyline", `${pct(m.moneyline?.accuracy)} acc`, `Brier ${num(m.moneyline?.brier, 4)} (mkt ${num(m.moneyline?.market_brier, 4)})`, `LogLoss ${num(m.moneyline?.log_loss, 4)}`, `${m.moneyline?.gated_bets?.record ?? "—"} · ROI ${pct(m.moneyline?.gated_bets?.roi)}`],
    ["Spread", `ATS ${m.spread?.ats_all_games?.record ?? "—"}`, `Brier ${num(m.spread?.brier, 4)}`, `Margin MAE ${num(m.spread?.margin_mae, 2)}`, `${m.spread?.gated_bets?.record ?? "—"} · ROI ${pct(m.spread?.gated_bets?.roi)}`],
    ["Total", `O/U ${m.total?.ou_all_games?.record ?? "—"}`, `Brier ${num(m.total?.brier, 4)}`, `Total MAE ${num(m.total?.total_mae, 2)}`, `${m.total?.gated_bets?.record ?? "—"} · ROI ${pct(m.total?.gated_bets?.roi)}`],
  ];
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-x-auto">
      <p className="px-3 pt-2.5 text-xs font-semibold text-foreground">
        Walk-forward backtest · {bt.seasons} · {bt.market_source}
      </p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground text-left">
            {["Market", "Record", "Brier", "Error", "Gated picks", "Calibration (ECE)", "Evidence gate"].map((h) => <th key={h} className="px-3 py-1.5 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, a, b, c, d], i) => {
            const key = MARKET_ORDER[i];
            const gate = m.evidence_gates?.[key];
            const ece = (m as Record<string, { calibration?: { ece: number } } | undefined>)[key]?.calibration?.ece;
            return (
              <tr key={name} className="border-t border-border/30">
                <td className="px-3 py-1.5 font-semibold text-foreground">{name}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{a}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{b}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{c}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{d}</td>
                <td className="px-3 py-1.5">{num(ece, 3)}</td>
                <td className={`px-3 py-1.5 whitespace-nowrap ${gate ? "text-emerald-400" : "text-red-400"}`}>
                  {gate ? `≥ ${(gate.min_edge * 100).toFixed(0)}% edge (${gate.bets} bets, ROI ${pct(gate.roi)})` : "none profitable → NO PLAY"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ data, label }: { data: GameSummary; label?: string }) {
  return (
    <div className="space-y-3">
      {data.forward_test && (
        <div className="space-y-2">
          <Notice>Forward test (shadow picks — never shown to users). Promotion: {data.forward_test.promotion_rule}.</Notice>
          <PerfTable title="Forward test by market" rows={data.forward_test.by_market} order={MARKET_ORDER} />
        </div>
      )}
      <StatCards perf={data.overall} label={label ? `${label} — published PLAYs` : "Published PLAYs"} />
      <PerfTable title="By market" rows={data.by_market} order={MARKET_ORDER} />
      <div className="grid gap-3 md:grid-cols-2">
        <PerfTable title="By edge bucket (PLAYs)" rows={data.by_edge_bucket} order={["3-5%", "5-8%", "8%+"]} />
        <PerfTable title="By confidence bucket (PLAYs)" rows={data.by_confidence_bucket} order={["60-65", "65-70", "70+"]} />
      </div>
      <Backtest bt={data.backtest} />
    </div>
  );
}

export const NflGameEdgeTab: React.FC<{ password: string }> = ({ password }) => {
  const versions = useNflVersions(password, "game_edge");
  const [version, setVersion] = useState("");
  const [compare, setCompare] = useState("");
  const [preset, setPreset] = useState<RangePreset>("season");
  useEffect(() => { if (!version && versions.length) setVersion(versions[versions.length - 1]); }, [versions, version]);
  const a = useNflSummary<GameSummary>(password, "game_summary", version, preset);
  const b = useNflSummary<GameSummary>(password, "game_summary", compare, preset);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-foreground">NFL Game Edge</h2>
        <p className="text-xs text-muted-foreground">Moneyline, spread and totals only. Player props are tracked separately.</p>
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
      {!version && <Notice>No NFL game-edge predictions or backtests yet.</Notice>}
      <div className={compare ? "grid gap-4 xl:grid-cols-2" : ""}>
        {a.data && <Summary data={a.data} label={version} />}
        {compare && b.data && <Summary data={b.data} label={compare} />}
      </div>
    </div>
  );
};
