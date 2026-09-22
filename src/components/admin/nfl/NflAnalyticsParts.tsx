import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Presentation-only building blocks for the two NFL admin tabs. Each tab calls
 * its OWN nfl-admin-analytics action (game_summary vs prop_summary); nothing
 * here combines the two engines' numbers.
 */

export interface Perf {
  predictions: number;
  plays: number;
  graded: number;
  record: string;
  win_rate: number | null;
  profit_units: number;
  roi: number | null;
  avg_edge: number | null;
  avg_ev: number | null;
  avg_confidence: number | null;
  avg_clv: number | null;
  clv_coverage: number | null;
  positive_clv_rate: number | null;
}

export type Engine = "game_edge" | "player_prop_edge";
export type RangePreset = "7d" | "30d" | "season" | "all";

export async function callNflAnalytics<T>(password: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("nfl-admin-analytics", { body: { password, ...body } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.reason ?? data.error);
  return data as T;
}

export function rangeFrom(preset: RangePreset): string | null {
  const now = Date.now();
  if (preset === "7d") return new Date(now - 7 * 86400e3).toISOString();
  if (preset === "30d") return new Date(now - 30 * 86400e3).toISOString();
  if (preset === "season") {
    const d = new Date();
    const year = d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    return new Date(Date.UTC(year, 7, 1)).toISOString();
  }
  return null;
}

/** Loads one engine's summary for a model version + range. */
export function useNflSummary<T>(password: string, action: "game_summary" | "prop_summary", version: string, preset: RangePreset) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!version) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      setData(await callNflAnalytics<T>(password, { action, model_version: version, from: rangeFrom(preset) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [password, action, version, preset]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function useNflVersions(password: string, engine: Engine) {
  const [versions, setVersions] = useState<string[]>([]);
  useEffect(() => {
    callNflAnalytics<Record<Engine, string[]>>(password, { action: "versions" })
      .then((v) => setVersions(v[engine] ?? []))
      .catch(() => setVersions([]));
  }, [password, engine]);
  return versions;
}

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
export const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : v.toFixed(digits);

export function Controls(props: {
  versions: string[];
  version: string;
  compare: string;
  preset: RangePreset;
  loading: boolean;
  onVersion: (v: string) => void;
  onCompare: (v: string) => void;
  onPreset: (p: RangePreset) => void;
  onRefresh: () => void;
}) {
  const sel = "bg-card border border-border/50 rounded-lg px-2 py-1.5 text-xs text-foreground";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={sel} value={props.version} onChange={(e) => props.onVersion(e.target.value)} aria-label="Model version">
        {props.versions.length === 0 && <option value="">No versions yet</option>}
        {props.versions.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <select className={sel} value={props.compare} onChange={(e) => props.onCompare(e.target.value)} aria-label="Compare with">
        <option value="">Compare: none</option>
        {props.versions.filter((v) => v !== props.version).map((v) => <option key={v} value={v}>vs {v}</option>)}
      </select>
      <div className="flex gap-1 p-0.5 rounded-lg bg-card/60 border border-border/40">
        {(["7d", "30d", "season", "all"] as RangePreset[]).map((p) => (
          <button
            key={p}
            onClick={() => props.onPreset(p)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold ${props.preset === p ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {p}
          </button>
        ))}
      </div>
      <button onClick={props.onRefresh} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <RefreshCw className={`w-3.5 h-3.5 ${props.loading ? "animate-spin" : ""}`} /> Refresh
      </button>
    </div>
  );
}

export function StatCards({ perf, label }: { perf: Perf | undefined; label?: string }) {
  if (!perf) return null;
  const cards: Array<[string, string]> = [
    ["Win rate", pct(perf.win_rate)],
    ["ROI", pct(perf.roi)],
    ["Record", perf.record],
    ["Avg edge", perf.avg_edge === null ? "—" : `${perf.avg_edge.toFixed(1)}%`],
    ["Avg EV", perf.avg_ev === null ? "—" : `${perf.avg_ev.toFixed(1)}%`],
    ["Avg conf", num(perf.avg_confidence, 1)],
    ["Avg CLV", pct(perf.avg_clv, 2)],
    ["Plays / preds", `${perf.plays} / ${perf.predictions}`],
  ];
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border/40 bg-card/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="text-sm font-bold text-foreground tabular-nums">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PerfTable({ title, rows, order }: { title: string; rows: Record<string, Perf> | undefined; order?: string[] }) {
  if (!rows) return null;
  const keys = order ? order.filter((k) => rows[k]).concat(Object.keys(rows).filter((k) => !order.includes(k))) : Object.keys(rows);
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-x-auto">
      <p className="px-3 pt-2.5 text-xs font-semibold text-foreground">{title}</p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground text-left">
            {["", "Plays", "Graded", "Record", "Win %", "ROI", "Edge", "EV", "Conf", "CLV"].map((h) => (
              <th key={h} className="px-3 py-1.5 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 && (
            <tr><td colSpan={10} className="px-3 py-3 text-muted-foreground">No predictions in range.</td></tr>
          )}
          {keys.map((k) => {
            const p = rows[k];
            return (
              <tr key={k} className="border-t border-border/30">
                <td className="px-3 py-1.5 font-semibold text-foreground whitespace-nowrap">{k}</td>
                <td className="px-3 py-1.5">{p.plays}</td>
                <td className="px-3 py-1.5">{p.graded}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{p.record}</td>
                <td className="px-3 py-1.5">{pct(p.win_rate)}</td>
                <td className={`px-3 py-1.5 ${p.roi !== null && p.roi < 0 ? "text-red-400" : p.roi ? "text-emerald-400" : ""}`}>{pct(p.roi)}</td>
                <td className="px-3 py-1.5">{p.avg_edge === null ? "—" : `${p.avg_edge.toFixed(1)}%`}</td>
                <td className="px-3 py-1.5">{p.avg_ev === null ? "—" : `${p.avg_ev.toFixed(1)}%`}</td>
                <td className="px-3 py-1.5">{num(p.avg_confidence, 1)}</td>
                <td className="px-3 py-1.5">{pct(p.avg_clv, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{children}</div>
  );
}
