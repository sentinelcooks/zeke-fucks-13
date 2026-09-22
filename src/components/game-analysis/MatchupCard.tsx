import { useState } from "react";
import { Shield } from "lucide-react";
import { getTeamLogoUrl, resolveLogoSport } from "@/utils/teamLogos";
import { useFirstPitchCountdown } from "./useFirstPitchCountdown";
import type { GameAnalysisContext } from "@/lib/gameAnalysisPresentation";
import { finiteValue } from "@/lib/finiteValue";

function initials(name: string) {
  return name.split(" ").map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}

function TeamBadge({ name, sportTitle }: { name: string; sportTitle: string }) {
  const [failed, setFailed] = useState(false);
  const sport = resolveLogoSport(sportTitle);
  const logo = sport ? getTeamLogoUrl(name, sport, 56) : "";

  if (logo && !failed) {
    return <img src={logo} alt="" aria-hidden className="mx-auto h-14 w-14 object-contain drop-shadow-md" onError={() => setFailed(true)} />;
  }
  return (
    <div
      className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-[13px] font-black text-accent"
      style={{ background: "hsla(250,76%,62%,0.12)", border: "1px solid hsla(250,76%,62%,0.24)" }}
    >
      {initials(name) || <Shield className="h-5 w-5" />}
    </div>
  );
}

function TeamColumn({ name, sportTitle, side }: { name: string; sportTitle: string; side: "Away" | "Home" }) {
  return (
    <div className="min-w-0 text-center">
      <TeamBadge name={name} sportTitle={sportTitle} />
      {/* Full club names run long ("Chicago White Sox"), and truncating them
          loses the half that identifies the team. Two lines keeps the name
          intact at phone width. */}
      <p className="mt-2 line-clamp-2 text-[12.5px] font-bold leading-tight text-foreground">{name}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground/55">{side}</p>
    </div>
  );
}

/**
 * Away / countdown / home, with the probable starters below a divider.
 *
 * Team records are in the mockup but nothing in the app fetches them, so that
 * line is simply absent rather than filled with a placeholder. The starters
 * row hides entirely until the model reports at least one name.
 */
export function MatchupCard({
  awayTeam,
  homeTeam,
  sportTitle,
  commenceTime,
  venue,
  status,
  context,
}: {
  awayTeam: string;
  homeTeam: string;
  sportTitle: string;
  commenceTime: string;
  venue?: string | null;
  status?: string | null;
  context?: GameAnalysisContext | null;
}) {
  const countdown = useFirstPitchCountdown(commenceTime, status);
  const awayStarter = context?.awayStarter;
  const homeStarter = context?.homeStarter;
  const showStarters = Boolean(awayStarter?.name || homeStarter?.name);

  const awayEra = finiteValue(awayStarter?.era);
  const homeEra = finiteValue(homeStarter?.era);
  const bothEras = awayEra !== null && homeEra !== null;

  return (
    <section
      className="overflow-hidden rounded-3xl border border-accent/20 p-5"
      style={{ background: "radial-gradient(circle at 85% 0%, hsla(250,76%,62%,0.26), transparent 42%), linear-gradient(145deg, hsla(245,34%,15%,0.96), hsla(228,25%,8%,0.96))" }}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamColumn name={awayTeam} sportTitle={sportTitle} side="Away" />
        <div className="px-1 text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/55">{countdown.label}</p>
          <p className={`my-0.5 text-[19px] font-black tabular-nums ${countdown.phase === "live" ? "text-nba-green" : "text-foreground"}`}>
            {countdown.display}
          </p>
          {venue ? <p className="text-[10px] text-muted-foreground/70">{venue}</p> : null}
        </div>
        <TeamColumn name={homeTeam} sportTitle={sportTitle} side="Home" />
      </div>

      {showStarters && (
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/[0.07] pt-3.5">
          <StarterColumn starter={awayStarter} align="left" better={bothEras && awayEra! < homeEra!} />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/45">Starters</span>
          <StarterColumn starter={homeStarter} align="right" better={bothEras && homeEra! < awayEra!} />
        </div>
      )}
    </section>
  );
}

function StarterColumn({
  starter,
  align,
  better,
}: {
  starter?: { name?: string | null; era?: number | null } | null;
  align: "left" | "right";
  better: boolean;
}) {
  const era = finiteValue(starter?.era);
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <p className="truncate text-[12px] font-bold text-foreground">{starter?.name || "TBD"}</p>
      {era !== null ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
          <span className={`text-[12px] font-bold ${better ? "text-nba-green" : "text-foreground"}`}>{era.toFixed(2)}</span> ERA
        </p>
      ) : (
        <p className="mt-0.5 text-[10px] text-muted-foreground/45">ERA unavailable</p>
      )}
    </div>
  );
}
