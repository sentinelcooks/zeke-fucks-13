// CSV / JSON export for the admin pick & edge history tabs.
// Pure helpers, no deps — safe to import from any client component.

export interface ExportablePick {
  id: string;
  pick_date: string;
  created_at?: string | null;
  graded_at?: string | null;
  sport: string;
  league?: string | null;
  tier?: string | null;
  model_used?: string | null;
  model_version?: string | null;
  bet_type?: string | null;
  player_name?: string | null;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type?: string | null;
  line?: number | null;
  direction?: string | null;
  hit_rate?: number | null;
  confidence?: number | null;
  edge_value?: number | null;
  odds?: string | null;
  opening_odds?: string | null;
  closing_odds?: string | null;
  clv?: number | null;
  stake_units?: number | null;
  profit_units?: number | null;
  result?: string | null;
  status?: string | null;
}

const CSV_COLUMNS: Array<keyof ExportablePick> = [
  "id", "pick_date", "created_at", "graded_at",
  "sport", "league", "tier",
  "model_used", "model_version",
  "bet_type", "player_name", "team", "opponent", "home_team", "away_team",
  "prop_type", "line", "direction",
  "hit_rate", "confidence", "edge_value",
  "odds", "opening_odds", "closing_odds", "clv",
  "stake_units", "profit_units",
  "result", "status",
];

const escapeCsv = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const pickHistoryToCsv = (rows: ExportablePick[]): string => {
  const header = CSV_COLUMNS.join(",");
  const body = rows
    .map((row) => CSV_COLUMNS.map((col) => escapeCsv(row[col])).join(","))
    .join("\n");
  return `${header}\n${body}`;
};

const downloadFile = (filename: string, mime: string, contents: string) => {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const exportPickHistory = (
  rows: ExportablePick[],
  format: "csv" | "json",
  filenamePrefix: string,
): void => {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    downloadFile(`${filenamePrefix}_${stamp}.csv`, "text/csv;charset=utf-8", pickHistoryToCsv(rows));
  } else {
    downloadFile(`${filenamePrefix}_${stamp}.json`, "application/json", JSON.stringify(rows, null, 2));
  }
};
