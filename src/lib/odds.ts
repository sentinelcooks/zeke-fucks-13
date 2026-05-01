// Shared American-odds helpers used by the admin history dashboards.
// Kept dependency-free so the same formulas can be mirrored in Deno
// edge functions (which can't import from src/).

export const parseAmericanOdds = (odds: string | number | null | undefined): number | null => {
  if (odds === null || odds === undefined || odds === "") return null;
  const s = String(odds).trim().replace(/^\+/, "");
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

export const americanToDecimal = (american: number): number =>
  american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);

export const americanToImpliedProb = (american: number): number =>
  american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);

// Profit in units for a 1-unit stake at the given American odds, given the result.
// `result` accepted in either pick-style ("hit"/"miss"/"push") or canonical
// ("win"/"loss"/"push") form. Returns null when result is pending/unknown.
export const profitUnits = (
  odds: string | number | null | undefined,
  result: string | null | undefined,
  stakeUnits = 1,
): number | null => {
  const r = (result || "").toLowerCase();
  if (r === "push") return 0;
  const isWin = r === "hit" || r === "win";
  const isLoss = r === "miss" || r === "loss";
  if (!isWin && !isLoss) return null;
  if (isLoss) return -stakeUnits;
  const american = parseAmericanOdds(odds);
  if (american === null) return null;
  return stakeUnits * (americanToDecimal(american) - 1);
};

// CLV (closing line value) as a percentage. Positive = beat the close.
// Computed from implied probabilities so it's symmetric for over/under sides.
export const computeClvPct = (
  openOdds: string | number | null | undefined,
  closeOdds: string | number | null | undefined,
): number | null => {
  const open = parseAmericanOdds(openOdds);
  const close = parseAmericanOdds(closeOdds);
  if (open === null || close === null) return null;
  return (americanToImpliedProb(close) - americanToImpliedProb(open)) * 100;
};
