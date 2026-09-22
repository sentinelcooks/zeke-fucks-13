import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The card shell every section on the game analysis screen sits in.
 *
 * Matches the props analysis page rather than the mockup's raw CSS: the
 * surface is `vision-card` from index.css, so a change to the app's card
 * treatment moves both screens together.
 */
export function AnalysisCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`vision-card p-4 ${className}`} style={{ borderColor: "hsla(228,30%,22%,0.35)" }}>
      {children}
    </section>
  );
}

/** Section heading: icon + uppercase title on the left, optional note on the right. */
export function CardHeading({
  icon: Icon,
  title,
  note,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-nba-green" />
        <h2 className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/80">{title}</h2>
      </div>
      {note ? <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70">{note}</span> : null}
    </div>
  );
}
