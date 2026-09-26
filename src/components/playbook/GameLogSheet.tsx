import { ChevronLeft, ChevronRight } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { boxScoreColumns, formatLine, type Direction, type ParsedGame } from "@/lib/propSplits";
import { cn } from "@/lib/utils";

function boxScoreFor(sport: string, propType: string | null | undefined, raw: Record<string, unknown>) {
  return boxScoreColumns(sport, propType)
    .map(([key, label]) => ({ key, label, value: raw[key] }))
    .filter((c) => c.value !== null && c.value !== undefined && c.value !== "");
}

/**
 * Bottom sheet for one game from the hit chart: result, the prop stat against
 * the line, and the box score. Previous/Next step through the current split.
 */
export function GameLogSheet({
  games,
  position,
  onPositionChange,
  onClose,
  sport,
  propType,
  playerName,
  propLabel,
  line,
  direction,
}: {
  games: ParsedGame[];
  position: number | null;
  onPositionChange: (pos: number) => void;
  onClose: () => void;
  sport: string;
  /** Analyzer prop key (e.g. "strikeouts"), used to pick box-score columns. */
  propType?: string | null;
  playerName: string;
  propLabel: string;
  line: number;
  direction: Direction;
}) {
  const game = position != null ? games[position] : undefined;
  const open = game != null;
  const hit = game ? (direction === "over" ? game.value > line : game.value < line) : false;
  const push = game ? game.value === line : false;
  const box = game ? boxScoreFor(sport, propType, game.raw) : [];

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="max-h-[88vh] border-0 bg-background">
        {game && (
          <div className="overflow-y-auto px-5 pb-safe-plus-4 pt-3">
            <DrawerTitle className="text-center text-[17px] font-semibold text-foreground">
              {game.dateLabel || "Game"} {game.opponent && `· ${game.away ? "@" : "vs"} ${game.opponent}`}
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              {playerName} {propLabel} in this game compared with the {formatLine(line)} line.
            </DrawerDescription>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-[22px] font-bold text-foreground">{playerName}</p>
                {game.result && (
                  <p className="text-[15px] text-muted-foreground">
                    <b className={game.result === "W" ? "text-success" : "text-danger"}>{game.result}</b>{" "}
                    {game.away ? "@" : "vs"} {game.opponent}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold",
                  push ? "bg-fill/20 text-muted-foreground" : hit ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
                )}
              >
                {push ? "Push" : hit ? "Hit" : "Miss"}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">{propLabel}</p>
                <p className="text-[28px] font-semibold tabular-nums text-foreground">
                  {!push && (
                    <span aria-hidden="true" className={cn("relative -top-1 mr-1 text-[12px]", hit ? "text-success" : "text-danger")}>
                      {game.value > line ? "▲" : "▼"}
                    </span>
                  )}
                  {formatLine(game.value)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Line</p>
                <p className="text-[28px] font-semibold tabular-nums text-foreground">{formatLine(line)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">Pick</p>
                <p className="text-[28px] font-semibold capitalize text-foreground">{direction}</p>
              </div>
            </div>

            {box.length > 0 && (
              <>
                <p className="mb-2 mt-6 text-[15px] font-semibold text-foreground">Box score</p>
                <div className="grid grid-cols-4 gap-2">
                  {box.map((c) => (
                    <div key={c.key} className="flex flex-col items-center rounded-2xl bg-card py-2.5 shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]">
                      <span className="text-[11px] font-semibold uppercase text-muted-foreground">{c.label}</span>
                      <span className="text-[20px] font-semibold tabular-nums text-foreground">{String(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mt-6 flex gap-2.5">
              <button
                type="button"
                disabled={position === 0}
                onClick={() => position != null && onPositionChange(position - 1)}
                className="flex h-11 flex-1 items-center justify-center gap-1 rounded-full bg-card text-[15px] font-semibold text-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))] disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" /> Previous game
              </button>
              <button
                type="button"
                disabled={position == null || position >= games.length - 1}
                onClick={() => position != null && onPositionChange(position + 1)}
                className="flex h-11 flex-1 items-center justify-center gap-1 rounded-full bg-card text-[15px] font-semibold text-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))] disabled:opacity-35"
              >
                Next game <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
