import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { CircleButton, GradeRing, PillTabs, StatKV } from "@/components/playbook/controls";
import { HitBars } from "@/components/playbook/HitBars";
import { GameLogSheet } from "@/components/playbook/GameLogSheet";
import {
  average,
  formatLine,
  hitRate,
  lineStep,
  parseGames,
  splitGames,
  type Direction,
  type ParsedGame,
  type SplitKey,
} from "@/lib/propSplits";
import { cn } from "@/lib/utils";

export interface PropAnalysisHeroProps {
  sport: string;
  playerName: string;
  teamName?: string | null;
  position?: string | null;
  jersey?: string | number | null;
  headshotUrl?: string | null;
  /** Human prop label, e.g. "Points". */
  propLabel: string;
  /** Analyzer prop key, e.g. "strikeouts" (picks the box-score columns). */
  propType?: string | null;
  /** The line and direction the model analyzed. */
  line: number;
  direction: Direction;
  /** Analyzer game_log rows (chronological, oldest first). */
  gameLog: unknown;
  /** Head-to-head rows vs the next opponent (previous season first, then this season). */
  h2hRows?: unknown;
  opponentLabel?: string | null;
  /** Model score 0–100 (or 0–1), shown as a grade ring when present. */
  modelScore?: number | null;
  modelIsProbability?: boolean;
  onModelPress?: () => void;
}

const SPLIT_LABELS: Record<SplitKey, string> = { season: "Season", h2h: "H2H", l5: "L5", l10: "L10", l20: "L20" };

function fmtAvg(n: number | null) {
  if (n == null) return "—";
  return n >= 50 ? String(Math.round(n)) : n.toFixed(1);
}

function Portrait({ name, url, jersey }: { name: string; url?: string | null; jersey?: string | number | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        className="h-[112px] w-[120px] rounded-2xl object-cover object-top [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
      />
    );
  }
  return (
    <svg viewBox="0 0 120 112" className="h-[112px] w-[120px]" aria-hidden="true">
      <circle cx="60" cy="40" r="20" style={{ fill: "hsl(var(--fill) / 0.2)" }} />
      <path d="M18 112c3-25 20-38 42-38s39 13 42 38z" style={{ fill: "hsl(var(--fill) / 0.2)" }} />
      {jersey != null && jersey !== "" && (
        <text x="60" y="104" textAnchor="middle" fontSize="20" fontWeight={800} style={{ fill: "hsl(var(--muted-foreground))" }}>
          {jersey}
        </text>
      )}
    </svg>
  );
}

/**
 * Top of the prop analysis screen (Playbook): player header, key numbers with a
 * model grade, a line/direction control, game-by-game hit bars and splits.
 * Tapping a bar opens that game's box score.
 */
export function PropAnalysisHero(props: PropAnalysisHeroProps) {
  const { sport, playerName, teamName, position, jersey, headshotUrl, propLabel, line, direction } = props;

  const games = useMemo(() => parseGames(props.gameLog), [props.gameLog]);
  const h2h = useMemo(() => parseGames(props.h2hRows), [props.h2hRows]);

  // Local "what if" controls. They only change the chart and hit rates;
  // the model score always belongs to the analyzed line and direction.
  const [chartLine, setChartLine] = useState(line);
  const [chartDir, setChartDir] = useState<Direction>(direction);
  const [split, setSplit] = useState<SplitKey>("l10");
  const [sheet, setSheet] = useState<{ games: ParsedGame[]; pos: number } | null>(null);

  useEffect(() => {
    setChartLine(line);
    setChartDir(direction);
    setSheet(null);
  }, [line, direction, props.gameLog]);

  const custom = chartLine !== line || chartDir !== direction;
  const step = lineStep(line);
  const values = games.map((g) => g.value);
  const l10 = values.slice(-10);
  const l10Avg = average(l10);
  const seasonAvg = average(values);
  const l10Rate = hitRate(l10, chartLine, chartDir);

  const splitKeys: SplitKey[] = ["season", "h2h", "l5", "l10", ...(games.length > 10 ? (["l20"] as SplitKey[]) : [])];
  const windowGames = splitGames(games, h2h, split);
  const modelPct =
    props.modelScore != null && Number.isFinite(Number(props.modelScore))
      ? Math.max(0, Math.min(100, Number(props.modelScore) <= 1 ? Number(props.modelScore) * 100 : Number(props.modelScore)))
      : null;

  const avgTrend = l10Avg == null ? undefined : (chartDir === "over" ? l10Avg > chartLine : l10Avg < chartLine) ? "up" : "down";

  return (
    <section aria-label={`${playerName} ${propLabel} analysis`} className="space-y-0">
      {/* Player header */}
      <div className="grid grid-cols-[1fr_120px] items-end gap-2">
        <div className="min-w-0 pb-3">
          <h2 className="truncate text-[28px] font-bold leading-tight tracking-tight text-foreground">{playerName}</h2>
          {teamName && <p className="truncate text-[15px] text-muted-foreground">{teamName}</p>}
          {(position || jersey) && (
            <p className="truncate text-[15px] text-muted-foreground">
              {[position, jersey != null && jersey !== "" ? `#${jersey}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <Portrait name={playerName} url={headshotUrl} jersey={jersey} />
      </div>

      {/* Key numbers + model grade */}
      <div className={cn("grid gap-x-2.5 gap-y-3 border-t border-border pt-3.5", modelPct != null ? "grid-cols-[1fr_1fr_1.15fr_100px]" : "grid-cols-3")}>
        <StatKV label="L10 Avg" value={fmtAvg(l10Avg)} trend={avgTrend} />
        <StatKV label="Line" value={formatLine(chartLine)} />
        <StatKV label="Prop" value={propLabel} wrap />
        {modelPct != null && (
          <button
            type="button"
            onClick={props.onModelPress}
            className="row-span-2 flex flex-col items-center justify-center gap-0.5 rounded-[18px] bg-card px-1 py-2 shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))] active:scale-[0.98]"
            aria-label={`${props.modelIsProbability ? "Probability" : "Model score"} ${Math.round(modelPct)}. Show details`}
          >
            <GradeRing value={modelPct} size={58} />
            <span className="flex items-center text-[12px] font-semibold text-foreground">
              {props.modelIsProbability ? "Probability" : "Model"}
              {props.onModelPress && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </span>
          </button>
        )}
        <StatKV label="Hit Rate" value={l10Rate.pct == null ? "—" : `${l10Rate.pct}%`} trend={l10Rate.pct == null ? undefined : l10Rate.pct >= 50 ? "up" : "down"} />
        <StatKV label="Opponent" value={props.opponentLabel || "—"} />
        <StatKV label="Season Avg" value={fmtAvg(seasonAvg)} />
      </div>

      {/* Direction + line (only useful when there are games to recount) */}
      {games.length > 0 && (
      <div className="flex items-center gap-2.5 pt-4">
        <PillTabs<Direction>
          ariaLabel="Direction"
          className="w-[168px]"
          value={chartDir}
          onChange={setChartDir}
          options={[{ value: "over", label: "Over" }, { value: "under", label: "Under" }]}
        />
        <div className="flex-1" />
        <CircleButton aria-label="Lower the line" onClick={() => setChartLine((l) => Math.max(step / 2, Math.round((l - step) * 10) / 10))}>
          <Minus />
        </CircleButton>
        <span className="min-w-[56px] text-center text-[17px] font-bold tabular-nums text-foreground" aria-live="polite">
          {formatLine(chartLine)}
        </span>
        <CircleButton aria-label="Raise the line" onClick={() => setChartLine((l) => Math.round((l + step) * 10) / 10)}>
          <Plus />
        </CircleButton>
      </div>
      )}
      {custom && games.length > 0 && (
        <div className="flex items-start justify-between gap-3 pt-2">
          <p className="text-[13px] text-muted-foreground">
            Hit rates use {chartDir === "over" ? "Over" : "Under"} {formatLine(chartLine)}. The model grade is for the
            analyzed pick, {direction === "over" ? "Over" : "Under"} {formatLine(line)}.
          </p>
          <button
            type="button"
            onClick={() => { setChartLine(line); setChartDir(direction); }}
            className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      )}

      {/* Game-by-game bars */}
      {games.length > 0 ? (
        <>
          <div className="-mx-1 pt-3">
            <HitBars
              games={windowGames.map((g) => ({ value: g.value, label: g.dateLabel, sublabel: g.opponent ? `${g.away ? "@" : ""}${g.opponent}` : undefined }))}
              line={chartLine}
              direction={chartDir}
              onSelect={(i) => setSheet({ games: windowGames, pos: i })}
            />
          </div>
          <PillTabs<SplitKey>
            ariaLabel="Games shown"
            className="mt-1"
            value={split}
            onChange={setSplit}
            options={splitKeys.map((k) => {
              const r = hitRate(splitGames(games, h2h, k).map((g) => g.value), chartLine, chartDir);
              return {
                value: k,
                label: SPLIT_LABELS[k],
                sub: (
                  <span className={r.pct == null ? "text-muted-foreground" : r.pct >= 55 ? "text-success" : r.pct < 50 ? "text-danger" : "text-foreground"}>
                    {r.pct == null ? "–" : `${r.pct}%`}
                  </span>
                ),
              };
            })}
          />
          <p className="pt-2 text-center text-[12px] text-muted-foreground">Tap a bar to see that game.</p>
        </>
      ) : (
        <p className="py-6 text-center text-[15px] text-muted-foreground">No game log is available for this prop yet.</p>
      )}

      <GameLogSheet
        games={sheet?.games ?? []}
        position={sheet?.pos ?? null}
        onPositionChange={(pos) => setSheet((s) => (s ? { ...s, pos } : s))}
        onClose={() => setSheet(null)}
        sport={sport}
        propType={props.propType}
        playerName={playerName}
        propLabel={propLabel}
        line={chartLine}
        direction={chartDir}
      />
    </section>
  );
}
