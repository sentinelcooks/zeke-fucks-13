import { useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  LineController,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, LineController, PointElement, Title, Tooltip, Legend);

interface ResultsPanelProps {
  data: any;
}

function fmtDate(raw: string) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function getHitRateColor(rate: number) {
  if (rate >= 65) return "text-nba-green";
  if (rate >= 50) return "text-nba-blue";
  if (rate >= 35) return "text-nba-yellow";
  return "text-nba-red";
}

function getHitRateBg(rate: number) {
  if (rate >= 65) return "bg-nba-green";
  if (rate >= 50) return "bg-nba-blue";
  if (rate >= 35) return "bg-nba-yellow";
  return "bg-nba-red";
}

function VerdictCard({ data }: { data: any }) {
  const v = data.verdict;
  const borderClass =
    v === "STRONG PICK" ? "border-[hsl(var(--nba-green))] shadow-[0_0_30px_hsl(var(--nba-green)/0.3)]" :
    v === "LEAN" ? "border-[hsl(var(--nba-blue))] shadow-[0_0_20px_hsl(var(--nba-blue)/0.2)]" :
    v === "RISKY" ? "border-[hsl(var(--nba-yellow))] shadow-[0_0_20px_hsl(var(--nba-yellow)/0.2)]" :
    "border-destructive shadow-[0_0_20px_hsl(var(--nba-red)/0.2)]";
  const textClass =
    v === "STRONG PICK" ? "text-nba-green" :
    v === "LEAN" ? "text-nba-blue" :
    v === "RISKY" ? "text-nba-yellow" : "text-nba-red";

  const scrollToAnalysis = () => {
    document.getElementById("analysis-breakdown")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className={`bg-card border-2 ${borderClass} rounded-2xl p-5 text-center flex flex-col items-center justify-center`}>
      <div className={`text-5xl font-extrabold ${textClass}`}>{data.confidence}%</div>
      <div className={`text-base font-extrabold tracking-[2px] mt-1 ${textClass}`}>{v}</div>
      <div className="text-muted-foreground text-xs mt-1.5">
        {data.over_under.toUpperCase()} {data.line} {data.prop_display}
      </div>
      <button
        onClick={scrollToAnalysis}
        className="mt-3 text-[11px] font-semibold text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
      >
        View AI Analysis ↓
      </button>
    </div>
  );
}

function HitRateBar({ title, data: hr }: { title: string; data: any }) {
  const rate = hr?.rate || 0;
  return (
    <div className="text-center">
      <div className="text-xs text-muted-foreground font-semibold mb-2">{title}</div>
      <div className="h-2 bg-input rounded-full overflow-hidden mb-1.5">
        <div
          className={`h-full rounded-full transition-all duration-700 ${getHitRateBg(rate)}`}
          style={{ width: `${rate}%` }}
        />
      </div>
      <div className={`text-sm font-bold ${getHitRateColor(rate)}`}>
        {hr?.total > 0 ? `${rate}% (${hr.hits}/${hr.total})` : "N/A"}
      </div>
    </div>
  );
}

function GameChart({ data }: { data: any }) {
  const games = data.game_log || [];
  const labels = games.map((g: any) => fmtDate(g.date));
  const values = games.map((g: any) => g.stat_value);
  const lineval = data.line;

  const colors = values.map((v: number) =>
    data.over_under === "over"
      ? v > lineval ? "rgba(0, 212, 170, 0.85)" : "rgba(255, 71, 87, 0.6)"
      : v < lineval ? "rgba(0, 212, 170, 0.85)" : "rgba(255, 71, 87, 0.6)"
  );

  return (
    <div className="h-[260px]">
      <Bar
        data={{
          labels,
          datasets: [
            {
              label: data.prop_display,
              data: values,
              backgroundColor: colors,
              borderRadius: 4,
              barPercentage: 0.7,
            } as any,
            {
              label: `Line (${lineval})`,
              data: Array(labels.length).fill(lineval),
              type: "line" as any,
              borderColor: "rgba(255,255,255,0.5)",
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#7a8299", font: { size: 11 } } },
          },
          scales: {
            x: { ticks: { color: "#7a8299", font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
            y: { ticks: { color: "#7a8299" }, grid: { color: "rgba(30,42,69,0.5)" }, beginAtZero: true },
          },
        }}
      />
    </div>
  );
}

function GamesTable({ games, line, overUnder, propType }: { games: any[]; line: number; overUnder: string; propType: string }) {
  const getStatVal = (g: any) => {
    if (propType === "pts+reb+ast") return (g.PTS || 0) + (g.REB || 0) + (g.AST || 0);
    const map: any = { points: "PTS", rebounds: "REB", assists: "AST", "3-pointers": "FG3M", steals: "STL", blocks: "BLK", turnovers: "TOV" };
    return g[map[propType]] || 0;
  };

  if (!games.length) return <p className="text-center text-muted-foreground py-5 text-sm">No games data</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-border">
            {["Date", "Matchup", "W/L", "MIN", "PTS", "REB", "AST", "3PM", "STL", "BLK", "Prop", "Hit?"].map((h) => (
              <th key={h} className="text-center py-2 px-1.5 text-muted-foreground uppercase tracking-wider font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((g: any, i: number) => {
            const sv = getStatVal(g);
            const isHit = overUnder === "over" ? sv > line : sv < line;
            return (
              <tr key={i} className="border-b border-border hover:bg-secondary/50 transition-colors">
                <td className="text-center py-2 px-1.5 whitespace-nowrap">{fmtDate(g.date)}</td>
                <td className="text-center py-2 px-1.5 whitespace-nowrap">{g.matchup}</td>
                <td className={`text-center py-2 px-1.5 ${g.result === "W" ? "text-nba-green" : "text-nba-red"}`}>{g.result}</td>
                <td className="text-center py-2 px-1.5">{g.MIN}</td>
                <td className="text-center py-2 px-1.5">{g.PTS}</td>
                <td className="text-center py-2 px-1.5">{g.REB}</td>
                <td className="text-center py-2 px-1.5">{g.AST}</td>
                <td className="text-center py-2 px-1.5">{g.FG3M}</td>
                <td className="text-center py-2 px-1.5">{g.STL}</td>
                <td className="text-center py-2 px-1.5">{g.BLK}</td>
                <td className="text-center py-2 px-1.5 font-bold">{sv}</td>
                <td className={`text-center py-2 px-1.5 font-extrabold ${isHit ? "text-nba-green" : "text-nba-red"}`}>
                  {isHit ? "HIT" : "MISS"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getReasoningClass(r: string) {
  const lower = r.toLowerCase();
  if (lower.includes("warning") || lower.includes("caution") || lower.includes("monitor")) return "bg-nba-yellow";
  if (lower.includes("low") || lower.includes("cold") || lower.includes("below") || lower.includes("unfavorable") || lower.includes("down") || lower.includes("do not bet")) return "bg-nba-red";
  if (lower.includes("strong") || lower.includes("hot") || lower.includes("above") || lower.includes("dominates") || lower.includes("favorable") || lower.includes("healthy") || lower.includes("up")) return "bg-nba-green";
  return "bg-muted-foreground";
}

const ResultsPanel = ({ data }: ResultsPanelProps) => {
  const h2h = data.head_to_head || {};
  const prev = data.prev_season_h2h || {};
  const comb = data.h2h_combined || {};
  const other = data.other_games || {};


  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Top Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Player Card */}
        <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
          {data.player?.headshot_url && (
            <img src={data.player.headshot_url} alt={data.player.full_name} className="w-20 h-[60px] object-cover rounded-xl bg-input" />
          )}
          <div>
            <h2 className="text-xl font-bold text-foreground">{data.player?.full_name}</h2>
            <p className="text-sm font-semibold text-accent">{data.player?.team_name}</p>
            <p className="text-xs text-muted-foreground">#{data.player?.jersey} | {data.player?.position}</p>
          </div>
        </div>

        <VerdictCard data={data} />

        {/* Next Game */}
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col justify-center">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Next Game</h3>
          <p className="text-base font-semibold text-foreground">
            {data.next_game ? `${data.next_game.is_home ? "vs" : "@"} ${data.next_game.opponent_name}` : "No upcoming game found"}
          </p>
          {data.next_game && <p className="text-xs text-muted-foreground mt-1">{data.next_game.date}</p>}
        </div>
      </div>

      {/* Stat Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Season Avg", val: data.season_hit_rate?.avg },
          { label: "L10 Avg", val: data.last_10?.avg },
          { label: "L5 Avg", val: data.last_5?.avg },
          
          { label: "H2H Avg", val: h2h.avg },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center">
            <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{s.label}</span>
            <span className="block text-2xl font-extrabold text-accent">{s.val ?? "--"}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <Section title="Game Log">
        <GameChart data={data} />
      </Section>

      {/* Hit Rates */}
      <Section title="Hit Rate Breakdown">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <HitRateBar title="Season" data={data.season_hit_rate} />
          <HitRateBar title="Last 10" data={data.last_10} />
          <HitRateBar title="Last 5" data={data.last_5} />
          
          <HitRateBar title={data.home_away?.location?.toUpperCase() || "Home/Away"} data={data.home_away} />
          <HitRateBar title={h2h.opponent ? `vs ${h2h.opponent}` : "vs Opponent"} data={h2h} />
        </div>
      </Section>

      {/* H2H Detail */}
      <Section title={h2h.opponent ? `Head-to-Head vs ${h2h.opponent}` : "Head-to-Head Matchup"}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <H2HStatCard label="This Season" rate={h2h.rate} total={h2h.total} hits={h2h.hits} avg={h2h.avg} fallback="No games this season" />
          <H2HStatCard label="Last Season" rate={prev.rate} total={prev.total} hits={prev.hits} avg={prev.avg} fallback="No games last season" />
          <H2HStatCard label="Combined" rate={comb.rate} total={comb.total} hits={comb.hits} avg={comb.avg} fallback="No data" highlight />
        </div>
        <GamesTable games={[...(h2h.games || []), ...(prev.games || [])]} line={data.line} overUnder={data.over_under} propType={data.prop_type} />
      </Section>

      {/* Other Games */}
      <Section title={other.opponent ? `All Other Games (Excluding vs ${other.opponent})` : "All Other Games"}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <H2HStatCard label="Hit Rate vs Others" rate={other.rate} total={other.total} hits={other.hits} avg={undefined} fallback="No data" />
          <div className="bg-input border border-border rounded-xl p-4 text-center flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Avg vs Others</span>
            <span className="text-2xl font-extrabold text-accent">{other.total > 0 ? other.avg : "--"}</span>
            <span className="text-xs text-muted-foreground">{other.total > 0 ? `${other.total} games` : ""}</span>
          </div>
          <div className="bg-input border border-border rounded-xl p-4 text-center flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">H2H vs Others Diff</span>
            {comb.total > 0 && other.total > 0 ? (() => {
              const diff = (comb.avg - other.avg).toFixed(1);
              const sign = Number(diff) > 0 ? "+" : "";
              const positive = data.over_under === "over" ? Number(diff) > 0 : Number(diff) < 0;
              return <>
                <span className={`text-2xl font-extrabold ${positive ? "text-nba-green" : "text-nba-red"}`}>{sign}{diff}</span>
                <span className="text-xs text-muted-foreground">{positive ? "Favorable" : "Unfavorable"}</span>
              </>;
            })() : <>
              <span className="text-2xl font-extrabold text-muted-foreground">--</span>
              <span className="text-xs text-muted-foreground">Need H2H data</span>
            </>}
          </div>
        </div>
        <GamesTable games={other.games || []} line={data.line} overUnder={data.over_under} propType={data.prop_type} />
      </Section>

      {/* Injuries */}
      <Section title="Injury Report">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h4 className="text-xs text-muted-foreground font-semibold mb-2">Player Status</h4>
            {data.player_injuries?.length > 0 ? (
              data.player_injuries.map((inj: any, i: number) => (
                <div key={i} className="text-sm py-1 border-b border-border">
                  <span className="text-nba-red font-bold">{inj.status.toUpperCase()}</span> - {inj.detail || "No details"}
                </div>
              ))
            ) : <span className="text-nba-green text-sm">Healthy - No injury designation</span>}
          </div>
          <div>
            <h4 className="text-xs text-muted-foreground font-semibold mb-2">Teammate Injuries</h4>
            {data.teammate_injuries?.length > 0 ? data.teammate_injuries.map((i: any, idx: number) => (
              <div key={idx} className="text-sm py-1 border-b border-border">{i.player_name} - <span className="text-nba-yellow">{i.status}</span></div>
            )) : <span className="text-sm text-muted-foreground">No injuries reported</span>}
          </div>
          <div>
            <h4 className="text-xs text-muted-foreground font-semibold mb-2">Opponent Injuries</h4>
            {data.opponent_injuries?.length > 0 ? data.opponent_injuries.map((i: any, idx: number) => (
              <div key={idx} className="text-sm py-1 border-b border-border">{i.player_name} - <span className="text-nba-yellow">{i.status}</span></div>
            )) : <span className="text-sm text-muted-foreground">No injuries reported</span>}
          </div>
        </div>
      </Section>

      {/* Minutes/TOI Trend */}
      <Section title={data.sport === "mlb" ? "At-Bats Trend" : data.sport === "nhl" ? "TOI Trend" : "Minutes Trend"}>
        {data.minutes_trend && data.minutes_trend.trend !== "insufficient_data" ? (
          <p className={`text-sm ${data.minutes_trend.trend === "up" ? "text-nba-green" : data.minutes_trend.trend === "down" ? "text-nba-red" : "text-muted-foreground"}`}>
            {data.minutes_trend.trend === "up" ? "↑" : data.minutes_trend.trend === "down" ? "↓" : "↔"}{" "}
            Average: <strong>{data.sport === "mlb" ? Math.round(data.minutes_trend.avg_min) : data.minutes_trend.avg_min} {data.sport === "mlb" ? "AB" : data.sport === "nhl" ? "TOI" : "min"}</strong> | Recent: <strong>{data.sport === "mlb" ? Math.round(data.minutes_trend.recent_avg) : data.minutes_trend.recent_avg} {data.sport === "mlb" ? "AB" : data.sport === "nhl" ? "TOI" : "min"}</strong> | Earlier: <strong>{data.sport === "mlb" ? Math.round(data.minutes_trend.early_avg) : data.minutes_trend.early_avg} {data.sport === "mlb" ? "AB" : data.sport === "nhl" ? "TOI" : "min"}</strong> | Trend: <strong>{data.minutes_trend.trend.toUpperCase()}</strong>
          </p>
        ) : <p className="text-sm text-muted-foreground">Not enough data for {data.sport === "mlb" ? "at-bats" : data.sport === "nhl" ? "TOI" : "minutes"} trend analysis</p>}
      </Section>

      {/* Reasoning */}
      <AnalysisBreakdown reasoning={data.reasoning || []} />
    </div>
  );
};

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="bg-card border border-border rounded-2xl p-5">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-4">{title}</h3>
      {children}
    </div>
  );
}

function prioritizeReasoning(reasoning: string[]): { key: string[]; extra: string[] } {
  const keyPatterns = [
    /hit rate/i, /avg/i, /projection/i, /exceeds/i, /strong/i, /fire/i,
    /teammates? out/i, /doubtful/i, /impact breakdown/i, /data-driven/i,
    /without key/i, /do not bet/i, /warning/i, /caution/i, /verdict/i,
    /edge/i, /ev\b/i, /expected value/i, /home split/i, /dominates/i,
    /matchup/i, /weaker/i, /favorable/i, /unfavorable/i, /healthy/i,
  ];
  const key: string[] = [];
  const extra: string[] = [];
  for (const r of reasoning) {
    if (keyPatterns.some((p) => p.test(r))) {
      key.push(r);
    } else {
      extra.push(r);
    }
  }
  if (key.length < 4 && extra.length > 0) {
    key.push(...extra.splice(0, 4 - key.length));
  }
  return { key, extra };
}

function AnalysisBreakdown({ reasoning }: { reasoning: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const { key, extra } = prioritizeReasoning(reasoning);
  const shown = expanded ? [...key, ...extra] : key;

  return (
    <Section title="Key Insights" id="analysis-breakdown">
      <ul className="space-y-0">
        {shown.map((r, i) => (
          <li key={i} className="py-2 border-b border-border last:border-0 text-sm leading-relaxed flex items-start gap-2.5">
            <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getReasoningClass(r)}`} />
            {r}
          </li>
        ))}
      </ul>
      {extra.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
        >
          {expanded ? "Show Less ↑" : `Show ${extra.length} More Details ↓`}
        </button>
      )}
    </Section>
  );
}

function H2HStatCard({ label, rate, total, hits, avg, fallback, highlight }: {
  label: string; rate?: number; total?: number; hits?: number; avg?: number; fallback: string; highlight?: boolean;
}) {
  return (
    <div className={`bg-input border rounded-xl p-4 text-center flex flex-col gap-1 ${highlight ? "border-accent shadow-[0_0_12px_hsl(var(--nba-green)/0.3)]" : "border-border"}`}>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {total && total > 0 ? (
        <>
          <span className={`text-2xl font-extrabold ${getHitRateColor(rate || 0)}`}>{rate}%</span>
          <span className="text-xs text-muted-foreground">{hits}/{total} games{avg !== undefined ? ` | Avg: ${avg}` : ""}</span>
        </>
      ) : (
        <>
          <span className="text-2xl font-extrabold text-muted-foreground">N/A</span>
          <span className="text-xs text-muted-foreground">{fallback}</span>
        </>
      )}
    </div>
  );
}

export default ResultsPanel;
