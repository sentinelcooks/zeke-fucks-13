import { ArrowUp, Sun } from "lucide-react";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import type { GameAnalysisContext } from "@/lib/gameAnalysisPresentation";
import { finiteValue } from "@/lib/finiteValue";

interface Condition {
  label: string;
  value: string;
  note: string;
  icon?: boolean;
}

/** Park factors are centred on 1.00 — above favours hitters, below favours pitchers. */
function parkNote(factor: number) {
  if (factor >= 1.05) return "Hitter friendly";
  if (factor >= 1.01) return "Slight hitter lean";
  if (factor <= 0.95) return "Pitcher friendly";
  if (factor <= 0.99) return "Slight pitcher lean";
  return "Neutral park";
}

/**
 * Park factor, temperature and wind at first pitch.
 *
 * Each tile appears only if the model verified that input. A closed roof is
 * reported as such rather than showing outdoor wind that will not affect play.
 */
export function ConditionsCard({ context }: { context?: GameAnalysisContext | null }) {
  if (!context) return null;

  const tiles: Condition[] = [];
  const park = finiteValue(context.parkRunFactor);
  if (park !== null) {
    tiles.push({ label: "Park", value: park.toFixed(2), note: parkNote(park) });
  }

  const weather = context.weather;
  const temperature = finiteValue(weather?.temperatureF);
  if (temperature !== null) {
    tiles.push({ label: "Temp", value: `${Math.round(temperature)}°`, note: weather?.condition || "At first pitch" });
  }

  const roofClosed = String(weather?.roofType ?? "").toLowerCase().includes("closed");
  const wind = finiteValue(weather?.windMph);
  if (roofClosed) {
    tiles.push({ label: "Roof", value: "Closed", note: "Wind not a factor" });
  } else if (wind !== null) {
    tiles.push({
      label: "Wind",
      value: String(Math.round(wind)),
      note: weather?.windDirection ? `mph ${weather.windDirection}` : "mph",
      icon: true,
    });
  }

  if (!tiles.length) return null;

  return (
    <AnalysisCard>
      <CardHeading icon={Sun} title="Conditions" note="At first pitch" />
      <div className={`mt-3 grid gap-2 ${tiles.length === 3 ? "grid-cols-3" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-2xl px-1.5 py-3 text-center"
            style={{ background: "hsla(228,24%,10%,0.7)", border: "1px solid hsla(228,30%,22%,0.35)" }}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{tile.label}</p>
            <p className="my-1 flex items-center justify-center gap-1 text-[18px] font-bold text-foreground">
              {tile.icon ? <ArrowUp className="h-3.5 w-3.5 text-nba-green" /> : null}
              {tile.value}
            </p>
            <p className="truncate text-[10px] text-muted-foreground/55">{tile.note}</p>
          </div>
        ))}
      </div>
    </AnalysisCard>
  );
}
