/**
 * Convert American odds to Decimal odds.
 * American +150 → Decimal 2.50
 * American -200 → Decimal 1.50
 */
export function americanToDecimal(american: number): number {
  if (american > 0) return +(american / 100 + 1).toFixed(2);
  return +(100 / Math.abs(american) + 1).toFixed(2);
}

/**
 * Format odds based on user preference.
 * Input is always American format (number or string like "+150" or "-200").
 */
export function formatOdds(odds: number | string, format: "american" | "decimal" = "american"): string {
  const num = typeof odds === "string" ? parseInt(odds, 10) : odds;
  if (isNaN(num)) return String(odds);

  if (format === "decimal") {
    return americanToDecimal(num).toFixed(2);
  }

  // American format
  return num > 0 ? `+${num}` : `${num}`;
}
