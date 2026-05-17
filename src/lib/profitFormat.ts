export type ProfitDisplayMode = "dollars" | "units";
export type UnitSetupMode = "calculated" | "manual";

export interface UnitSettings {
  setupMode: UnitSetupMode;
  bankroll: number;   // parsed, NaN-safe
  riskPct: number;    // 1 | 2 | 3 | custom
  manualUnit: number; // parsed
}

/** Returns the active 1U dollar value, or null if not configured. */
export function getActiveUnitSize(s: UnitSettings): number | null {
  if (s.setupMode === "manual") {
    return Number.isFinite(s.manualUnit) && s.manualUnit > 0 ? s.manualUnit : null;
  }
  // calculated
  const val = (s.bankroll * s.riskPct) / 100;
  return Number.isFinite(val) && val > 0 ? val : null;
}

/**
 * Format a dollar-denominated profit/loss for display.
 * Falls back to dollars when unitSize is null/0.
 */
export function formatProfit(
  valueDollars: number,
  mode: ProfitDisplayMode,
  unitSize: number | null
): string {
  if (!Number.isFinite(valueDollars)) {
    return mode === "units" && unitSize && unitSize > 0 ? "0.00U" : "$0.00";
  }

  if (mode === "units" && unitSize && unitSize > 0) {
    const units = valueDollars / unitSize;
    if (valueDollars === 0) return "0.00U";
    if (valueDollars > 0) return `+${units.toFixed(2)}U`;
    return `-${Math.abs(units).toFixed(2)}U`;
  }

  // dollars
  if (valueDollars === 0) return "$0.00";
  const abs = Math.abs(valueDollars).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return valueDollars > 0 ? `+$${abs}` : `-$${abs}`;
}

export interface FormattedProfit {
  text: string;
  isPositive: boolean;
  isZero: boolean;
}

/** Convenience wrapper that also returns sign information for styling. */
export function formatProfitSigned(
  valueDollars: number,
  mode: ProfitDisplayMode,
  unitSize: number | null
): FormattedProfit {
  return {
    text: formatProfit(valueDollars, mode, unitSize),
    isPositive: Number.isFinite(valueDollars) && valueDollars > 0,
    isZero: !Number.isFinite(valueDollars) || valueDollars === 0,
  };
}

/** Read all unit settings from localStorage (pure, no React). */
export function readUnitSettings(): UnitSettings {
  const setupMode =
    (localStorage.getItem("sentinel_unit_setup_mode") as UnitSetupMode) ?? "calculated";
  const bankroll = parseFloat(localStorage.getItem("sentinel_unit_bankroll") ?? "");
  const riskKey = localStorage.getItem("sentinel_unit_risk") ?? "standard";
  const customPct = parseFloat(localStorage.getItem("sentinel_unit_custom_pct") ?? "2");
  const PRESET_PCTS: Record<string, number> = {
    conservative: 1,
    standard: 2,
    aggressive: 3,
  };
  const riskPct = riskKey === "custom" ? customPct : (PRESET_PCTS[riskKey] ?? 2);
  const manualUnit = parseFloat(localStorage.getItem("sentinel_unit_manual") ?? "");
  return {
    setupMode,
    bankroll: Number.isFinite(bankroll) ? bankroll : 0,
    riskPct: Number.isFinite(riskPct) ? riskPct : 2,
    manualUnit: Number.isFinite(manualUnit) ? manualUnit : 0,
  };
}

/** Read the current profit display mode from localStorage. */
export function readProfitDisplayMode(): ProfitDisplayMode {
  return (localStorage.getItem("sentinel_profit_display_mode") as ProfitDisplayMode) ?? "dollars";
}
