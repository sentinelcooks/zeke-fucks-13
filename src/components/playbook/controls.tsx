import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Round glass icon button (44pt tap target). Always pass an aria-label. */
export const CircleButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "md" | "sm" }>(
  ({ className, active, size = "md", children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-card text-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline)),0_1px_3px_rgba(0,0,0,0.06)] transition-transform active:scale-95 disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5",
        size === "md" ? "h-11 w-11" : "h-9 w-9 [&_svg]:h-4 [&_svg]:w-4",
        active && "text-warning",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
CircleButton.displayName = "CircleButton";

export interface PillOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional second line (e.g. a hit rate under a split label). */
  sub?: ReactNode;
}

/** Capsule segmented control. Set `scroll` for a horizontally scrolling tab strip. */
export function PillTabs<T extends string>({
  options,
  value,
  onChange,
  scroll = false,
  className,
  ariaLabel,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (v: T) => void;
  scroll?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-0.5 rounded-full bg-card p-1 shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]",
        scroll && "overflow-x-auto scrollbar-hide",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center justify-center whitespace-nowrap rounded-full text-[15px] transition-colors",
              scroll ? "shrink-0 px-4" : "flex-1 px-2",
              o.sub != null ? "h-11 flex-col text-[11.5px] font-semibold" : "h-9",
              on
                ? "bg-pill font-semibold text-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]"
                : "font-medium text-muted-foreground",
            )}
          >
            <span>{o.label}</span>
            {o.sub != null && <b className="text-[15px] font-bold">{o.sub}</b>}
          </button>
        );
      })}
    </div>
  );
}

/** Letter grade in a progress ring. Green ≥60, orange ≥50, red below. */
export function GradeRing({ value, size = 62 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = value >= 60 ? "hsl(var(--success))" : value >= 50 ? "hsl(var(--warning))" : "hsl(var(--danger))";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Grade ${gradeFor(value)}, ${Math.round(value)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--fill) / 0.2)" strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${((Math.max(0, Math.min(100, value)) / 100) * c).toFixed(1)} ${c.toFixed(1)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.33} fontWeight={700} fill="hsl(var(--foreground))">
        {gradeFor(value)}
      </text>
    </svg>
  );
}

export function gradeFor(v: number) {
  return v >= 70 ? "A" : v >= 65 ? "A−" : v >= 60 ? "B+" : v >= 55 ? "B" : v >= 50 ? "C+" : "C";
}

/** Small uppercase label over a value, with an optional ▲/▼ trend. `wrap` allows two lines. */
export function StatKV({ label, value, trend, wrap, className }: { label: ReactNode; value: ReactNode; trend?: "up" | "down"; wrap?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">{label}</span>
      <span className={cn("text-[17px] font-semibold tabular-nums text-foreground", wrap ? "line-clamp-2 leading-tight" : "truncate")}>
        {trend && (
          <span aria-hidden="true" className={cn("relative -top-0.5 mr-1 text-[11px]", trend === "up" ? "text-success" : "text-danger")}>
            {trend === "up" ? "▲" : "▼"}
          </span>
        )}
        {value}
      </span>
    </div>
  );
}
