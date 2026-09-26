export interface HitBarGame {
  value: number;
  /** First label line under the bar, e.g. "9/15". */
  label: string;
  /** Second label line, e.g. "@CLE". Hidden when there are more than 10 bars. */
  sublabel?: string;
}

/**
 * Game-by-game bars against a prop line: green = hit, red = miss, gray = push.
 * Values print inside the bars when there is room; tapping a bar calls onSelect.
 */
export function HitBars({
  games,
  line,
  direction = "over",
  onSelect,
  height = 200,
}: {
  games: HitBarGame[];
  line: number;
  direction?: "over" | "under";
  onSelect?: (index: number) => void;
  height?: number;
}) {
  const n = games.length;
  if (!n) {
    return <p className="py-8 text-center text-[15px] text-muted-foreground">No games in this split.</p>;
  }

  const W = 390;
  const L = 34;
  const R = 382;
  const top = 14;
  const bot = height - 40;
  const max = Math.max(...games.map((g) => g.value), line) * 1.12 || 1;
  const y = (v: number) => bot - (v / max) * (bot - top);
  const gap = n > 10 ? 3 : 5;
  const bw = (R - L - gap * (n - 1)) / n;
  const ly = y(line);
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" className="block" role="img" aria-label={`${n} games against a line of ${fmt(line)}`}>
      <text x={4} y={top + 4} fontSize={12} fill="hsl(var(--muted-foreground))">{Math.round(max)}</text>
      <text x={4} y={bot} fontSize={12} fill="hsl(var(--muted-foreground))">0</text>

      {games.map((g, k) => {
        const hit = direction === "over" ? g.value > line : g.value < line;
        const push = g.value === line;
        const x = L + k * (bw + gap);
        const h = Math.max(bot - y(g.value), 3);
        const fill = push ? "hsl(var(--fill) / 0.35)" : hit ? "hsl(var(--success))" : "hsl(var(--danger))";
        const textFill = push ? "hsl(var(--foreground))" : hit ? "hsl(var(--success-foreground))" : "#fff";
        return (
          <g
            key={k}
            onClick={onSelect ? () => onSelect(k) : undefined}
            style={onSelect ? { cursor: "pointer" } : undefined}
            role={onSelect ? "button" : undefined}
            aria-label={onSelect ? `${g.label} ${g.sublabel ?? ""}: ${fmt(g.value)}` : undefined}
          >
            <rect x={x} y={y(g.value)} width={bw} height={h} rx={n > 10 ? 2 : 4} fill={fill} />
            {n <= 10 && h > 22 && (
              <text x={x + bw / 2} y={bot - 7} fontSize={13} fontWeight={700} fill={textFill} textAnchor="middle">
                {fmt(g.value)}
              </text>
            )}
            {(n <= 10 || k % 4 === 3) && (
              <text x={x + bw / 2} y={bot + 16} fontSize={11} fill="hsl(var(--muted-foreground))" textAnchor="middle">
                {g.label}
              </text>
            )}
            {n <= 10 && g.sublabel && (
              <text x={x + bw / 2} y={bot + 30} fontSize={11} fill="hsl(var(--muted-foreground))" textAnchor="middle">
                {g.sublabel}
              </text>
            )}
          </g>
        );
      })}

      <line x1={L - 4} x2={R} y1={ly} y2={ly} stroke="hsl(var(--foreground))" strokeWidth={1.2} opacity={0.85} />
      <text x={4} y={ly - 5} fontSize={12} fontWeight={700} fill="hsl(var(--foreground))">{fmt(line)}</text>
    </svg>
  );
}
