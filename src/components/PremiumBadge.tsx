import { Crown } from "lucide-react";

/**
 * Small visual label indicating a feature requires Sentinel Premium.
 * Used to clearly distinguish paid content from free content (Apple
 * App Review Guideline 3.1.2 — paid/subscription features must be
 * unambiguously labelled to free users).
 */
export function PremiumBadge({
  className = "",
  label = "Premium",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-[hsl(var(--nba-yellow))]/15 border border-[hsl(var(--nba-yellow))]/30 px-2 py-0.5 text-[9px] font-extrabold tracking-wider uppercase text-[hsl(var(--nba-yellow))] ${className}`}
    >
      <Crown className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}
