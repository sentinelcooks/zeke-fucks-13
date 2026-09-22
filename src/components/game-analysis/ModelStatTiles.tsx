import { finiteValue } from "@/lib/finiteValue";

interface Tile {
  label: string;
  value: string;
  accent: boolean;
}

/**
 * Model / Line / Gap / Data coverage.
 *
 * A tile whose value the model did not return is dropped rather than shown as
 * a dash, so the row never pads itself out with blanks. With no tiles at all
 * the row disappears.
 */
export function ModelStatTiles({
  projection,
  line,
  coverage,
  unit,
}: {
  projection?: number | null;
  line?: number | null;
  coverage?: number | null;
  unit?: string;
}) {
  const tiles: Tile[] = [];

  const projectionValue = finiteValue(projection);
  const lineValue = finiteValue(line);
  const coverageValue = finiteValue(coverage);

  if (projectionValue !== null) tiles.push({ label: "Model", value: projectionValue.toFixed(1), accent: true });
  if (lineValue !== null) tiles.push({ label: "Line", value: lineValue.toFixed(1), accent: false });
  if (projectionValue !== null && lineValue !== null) {
    const gap = projectionValue - lineValue;
    tiles.push({ label: "Gap", value: `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`, accent: true });
  }
  if (coverageValue !== null) {
    tiles.push({ label: "Data", value: `${Math.round(coverageValue * 100)}%`, accent: true });
  }

  if (!tiles.length) return null;

  return (
    // Columns match the tile count exactly, so a row that lost tiles to
    // missing data stays balanced instead of leaving a half-width orphan.
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 4)}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="vision-card px-1 py-3.5 text-center"
          style={{ borderColor: "hsla(228,30%,22%,0.35)" }}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{tile.label}</p>
          <p className={`mt-1 text-[22px] font-black tabular-nums ${tile.accent ? "text-nba-green" : "text-foreground"}`}>
            {tile.value}
          </p>
          {tile.label === "Model" && unit ? <p className="text-[8px] text-muted-foreground/45">{unit}</p> : null}
        </div>
      ))}
    </div>
  );
}
