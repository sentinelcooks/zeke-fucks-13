import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Activity } from "lucide-react";
import { formatOdds } from "@/utils/oddsFormat";
import { tierForScore } from "@/lib/gameAnalysisTiers";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import { finiteValue } from "@/lib/finiteValue";

// 270° of a r=74 circle. The full circumference is the dash gap, so the arc
// never wraps past its own start.
const RADIUS = 74;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_LENGTH = CIRCUMFERENCE * 0.75;

/** Counts the dial number up from zero, matching the arc sweep. */
function useCountUp(target: number | null, enabled: boolean) {
  const [value, setValue] = useState(enabled ? 0 : Math.round(target ?? 0));
  const frame = useRef<number>();

  useEffect(() => {
    const to = Math.round(target ?? 0);
    if (!enabled) {
      setValue(to);
      return;
    }
    const from = 0;
    const started = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / 800);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, enabled]);

  return value;
}

export interface ModelSignalProps {
  /** 0-100 directional model score. */
  score: number | null;
  marketTitle: string;
  /** e.g. "Over 8.0" */
  pickLabel: string;
  price?: number | null;
  /** Model's projected value on the market's scale. Null hides the gauge. */
  projection?: number | null;
  /** Sportsbook line on the same scale. */
  line?: number | null;
  /** Unit word for the gauge ends, e.g. "runs". */
  unit?: string;
}

/**
 * The hero: a 270° dial for the model score, the tier, the pick, and a gauge
 * placing the model's projection against the book's line.
 *
 * The gauge only renders when the model returned a projected value — that is
 * the totals market today. For moneyline and spread there is no number to plot,
 * and drawing an empty gauge would imply one exists.
 */
export function ModelSignalCard({ score, marketTitle, pickLabel, price, projection, line, unit = "runs" }: ModelSignalProps) {
  const reduceMotion = useReducedMotion();
  const tier = tierForScore(score);
  const displayed = useCountUp(score, !reduceMotion);
  const scoreValue = finiteValue(score);
  const hasScore = scoreValue !== null;

  const sweep = hasScore ? (ARC_LENGTH * Math.max(0, Math.min(100, scoreValue))) / 100 : 0;

  const projectionValue = finiteValue(projection);
  const lineValue = finiteValue(line);
  const showGauge = projectionValue !== null && lineValue !== null;

  return (
    <AnalysisCard className="text-center">
      <CardHeading icon={Activity} title="Model signal" note={marketTitle} />

      <div className="relative mx-auto mt-2 h-[176px] w-[200px]">
        <svg viewBox="0 0 200 176" className="absolute inset-0" aria-hidden>
          <circle
            cx="100" cy="96" r={RADIUS} fill="none" strokeWidth="10" strokeLinecap="round"
            stroke="hsla(228,24%,20%,0.85)"
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
            transform="rotate(135 100 96)"
          />
          <circle
            cx="100" cy="96" r={RADIUS} fill="none" strokeWidth="10" strokeLinecap="round"
            stroke={tier.color}
            strokeDasharray={`${sweep} ${CIRCUMFERENCE}`}
            transform="rotate(135 100 96)"
            style={reduceMotion ? undefined : { transition: "stroke-dasharray 1s cubic-bezier(.2,.8,.2,1), stroke .3s" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-1.5">
          <p className="text-[54px] font-black leading-none tracking-tight tabular-nums" style={{ color: tier.color }}>
            {hasScore ? displayed : "--"}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-muted-foreground/55">out of 100</p>
        </div>
      </div>

      <p className="-mt-2 text-[19px] font-black tracking-[0.28em] pl-[0.28em]" style={{ color: tier.color }}>
        {tier.label}
      </p>

      <p className="mt-2 text-[14px] text-muted-foreground">
        <span className="font-bold text-foreground">{pickLabel}</span>
        {finiteValue(price) !== null ? ` at ${formatOdds(finiteValue(price)!)}` : ""}
      </p>

      {showGauge && <ProjectionGauge projection={projectionValue} line={lineValue} color={tier.color} unit={unit} />}
    </AnalysisCard>
  );
}

/**
 * Horizontal gauge: the book's line as a fixed tick, the model's projection as
 * a dot, and the distance between them filled in the tier colour.
 *
 * The scale is built around both values with padding, so the pair is always
 * visible and the gap is legible even when it is small.
 */
function ProjectionGauge({ projection, line, color, unit }: { projection: number; line: number; color: string; unit: string }) {
  const spread = Math.max(Math.abs(projection - line) * 2, 2);
  const min = Math.min(projection, line) - spread / 2;
  const max = Math.max(projection, line) + spread / 2;
  const pct = (value: number) => ((value - min) / (max - min)) * 100;

  const linePct = pct(line);
  const projectionPct = pct(projection);
  const left = Math.min(linePct, projectionPct);
  const width = Math.abs(projectionPct - linePct);

  return (
    <div className="mt-6 px-1">
      <div className="relative px-1 pb-6 pt-5">
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold"
          style={{ left: `${projectionPct}%`, color }}
        >
          Model {projection.toFixed(1)}
        </span>

        <div className="relative h-1.5 rounded-full" style={{ background: "hsla(228,24%,20%,0.9)" }}>
          <div className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: color }} />
          <span className="absolute top-1/2 h-[18px] w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white" style={{ left: `${linePct}%` }} />
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${projectionPct}%`, background: color, border: "3px solid hsl(230 30% 10%)" }}
          />
        </div>

        <span
          className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-muted-foreground"
          style={{ left: `${linePct}%` }}
        >
          Line {line.toFixed(1)}
        </span>
      </div>

      <div className="flex justify-between text-[9px] text-muted-foreground/45">
        <span>{min.toFixed(1)} {unit}</span>
        <span>{max.toFixed(1)} {unit}</span>
      </div>
    </div>
  );
}
