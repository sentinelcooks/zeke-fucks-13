import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

interface Play {
  id: string;
  sport: string;
  result: string;
  payout: number;
  stake: number;
  created_at: string;
}

interface ProfitChartsProps {
  plays: Play[];
}

const GRID_COLOR = "hsla(228, 20%, 18%, 0.35)";
const AXIS_COLOR = "hsla(228, 15%, 40%, 0.7)";
const TOOLTIP_BG = "hsla(228, 22%, 8%, 0.97)";
const TOOLTIP_BORDER = "hsla(228, 25%, 22%, 0.4)";
const GREEN = "hsl(145, 70%, 50%)";
const GREEN_DIM = "hsl(145, 50%, 38%)";
const RED = "hsl(0, 72%, 55%)";
const RED_DIM = "hsl(0, 55%, 42%)";

const ProfitCharts = ({ plays }: ProfitChartsProps) => {
  const [view, setView] = useState<"cumulative" | "daily">("cumulative");

  const settled = useMemo(
    () =>
      plays
        .filter((p) => p.result !== "pending")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [plays]
  );

  const cumulativeData = useMemo(() => {
    let running = 0;
    return settled.map((p) => {
      running += p.payout || 0;
      return {
        date: new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        profit: parseFloat(running.toFixed(2)),
      };
    });
  }, [settled]);

  const dailyData = useMemo(() => {
    const map: Record<string, number> = {};
    settled.forEach((p) => {
      const day = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      map[day] = (map[day] || 0) + (p.payout || 0);
    });
    return Object.entries(map).map(([date, profit]) => ({
      date,
      profit: parseFloat(profit.toFixed(2)),
    }));
  }, [settled]);

  if (settled.length < 2) {
    return (
      <div className="vision-card p-5 mb-3 text-center">
        <p className="text-[11px] text-muted-foreground/50 py-6">
          Complete at least 2 plays to see profit charts
        </p>
      </div>
    );
  }

  const lastCumulative = cumulativeData.length > 0 ? cumulativeData[cumulativeData.length - 1].profit : 0;
  const isPositive = lastCumulative >= 0;

  const totalProfit = lastCumulative;
  const winDays = dailyData.filter(d => d.profit > 0).length;
  const lossDays = dailyData.filter(d => d.profit < 0).length;
  const bestDay = dailyData.length > 0 ? Math.max(...dailyData.map(d => d.profit)) : 0;
  const worstDay = dailyData.length > 0 ? Math.min(...dailyData.map(d => d.profit)) : 0;

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value as number;
    return (
      <div className="rounded-xl px-3.5 py-2.5 text-[11px] shadow-2xl backdrop-blur-xl"
        style={{ background: TOOLTIP_BG, border: `1px solid ${TOOLTIP_BORDER}` }}>
        <p className="text-muted-foreground/50 text-[9px] font-medium mb-1 tracking-wide">{label}</p>
        <p className="font-black text-[14px] tabular-nums" style={{ color: val >= 0 ? GREEN : RED }}>
          {val >= 0 ? "+" : ""}${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
    );
  };

  return (
    <div className="vision-card p-4 mb-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-black text-foreground/90 uppercase tracking-[0.15em]">
            Profit Trend
          </h3>
          <div className="flex items-center gap-1">
            {isPositive ? (
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
            )}
            <span className="text-[11px] font-bold tabular-nums" style={{ color: isPositive ? GREEN : RED }}>
              {isPositive ? "+" : ""}${Math.abs(totalProfit).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: 'hsla(228, 20%, 12%, 0.6)' }}>
          {(["cumulative", "daily"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 text-[9px] font-bold rounded-md transition-all capitalize tracking-wider ${
                view === v
                  ? "text-accent-foreground shadow-sm"
                  : "text-muted-foreground/50 hover:text-foreground/70"
              }`}
              style={view === v ? { background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))' } : {}}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Mini Stats Row */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Win Days", value: winDays.toString(), color: GREEN },
          { label: "Loss Days", value: lossDays.toString(), color: RED },
          { label: "Best Day", value: `+$${bestDay.toFixed(0)}`, color: GREEN },
          { label: "Worst Day", value: `${worstDay >= 0 ? "+$" : "-$"}${Math.abs(worstDay).toFixed(0)}`, color: worstDay >= 0 ? GREEN : RED },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg px-2 py-1.5 text-center"
            style={{ background: 'hsla(228, 20%, 12%, 0.5)', border: '1px solid hsla(228, 30%, 18%, 0.3)' }}>
            <p className="text-[8px] text-muted-foreground/45 font-semibold uppercase tracking-wider">{stat.label}</p>
            <p className="text-[11px] font-black tabular-nums mt-0.5" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="h-[220px] -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          {view === "cumulative" ? (
            <AreaChart data={cumulativeData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="profitGradientGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                  <stop offset="50%" stopColor={GREEN} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="profitGradientRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={RED} stopOpacity={0} />
                  <stop offset="50%" stopColor={RED} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={RED} stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="lineGreen" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={GREEN_DIM} />
                  <stop offset="100%" stopColor={GREEN} />
                </linearGradient>
                <linearGradient id="lineRed" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={RED_DIM} />
                  <stop offset="100%" stopColor={RED} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} dy={6} />
              <YAxis tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} domain={['auto', 'auto']} width={48} />
              <Tooltip content={customTooltip} cursor={{ stroke: 'hsla(228, 20%, 40%, 0.3)', strokeDasharray: '4 4' }} />
              <ReferenceLine y={0} stroke="hsla(228, 15%, 30%, 0.4)" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="profit"
                stroke={isPositive ? "url(#lineGreen)" : "url(#lineRed)"} strokeWidth={2.5}
                fill={isPositive ? "url(#profitGradientGreen)" : "url(#profitGradientRed)"}
                baseValue={0} dot={false} activeDot={{ r: 4, fill: isPositive ? GREEN : RED, stroke: 'hsla(228, 22%, 8%, 0.9)', strokeWidth: 2 }} />
            </AreaChart>
          ) : (
            <BarChart data={dailyData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap="30%" barGap={4}>
              <defs>
                <linearGradient id="barGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={GREEN_DIM} stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="barRed" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor={RED} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={RED_DIM} stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} dy={6} padding={{ left: 20, right: 20 }} />
              <YAxis tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} domain={['auto', 'auto']} width={48} />
              <Tooltip content={customTooltip} cursor={{ fill: 'hsla(228, 20%, 20%, 0.15)', radius: 4 }} />
              <ReferenceLine y={0} stroke="hsla(228, 15%, 30%, 0.4)" strokeDasharray="4 4" />
              <Bar dataKey="profit" radius={[6, 6, 2, 2]} maxBarSize={40} minPointSize={3}>
                {dailyData.map((entry, i) => (
                  <Cell key={i} fill={entry.profit >= 0 ? "url(#barGreen)" : "url(#barRed)"} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ProfitCharts;
