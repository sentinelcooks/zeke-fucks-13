/**
 * NFL PLAYER PROP EDGE ENGINE — settlement + CLV (pure).
 *
 * A player with no stat line for the game did not play → `void` (books void
 * those props). CLV follows the same same-line rule as the game engine's
 * grader but is computed independently here.
 */

import { americanToImplied, devigPair } from "../../prob_math.ts";

export type PropResult = "win" | "loss" | "push" | "void";

export interface PropPredictionToGrade {
  side: "over" | "under";
  line: number;
  market_price: number | null;
  no_vig_probability: number | null;
}

export function settleProp(p: PropPredictionToGrade, actual: number | null): { result: PropResult; profit_units: number } {
  if (actual === null) return { result: "void", profit_units: 0 };
  const diff = actual - p.line;
  const result: PropResult = diff === 0 ? "push" : (p.side === "over") === (diff > 0) ? "win" : "loss";
  const price = p.market_price ?? -110;
  const win = price > 0 ? price / 100 : 100 / -price;
  return { result, profit_units: result === "win" ? Math.round(win * 1e4) / 1e4 : result === "loss" ? -1 : 0 };
}

export function propClv(
  p: PropPredictionToGrade,
  closing: { line: number; over_price: number | null; under_price: number | null } | null,
): { closing_line: number | null; closing_price: number | null; closing_no_vig_probability: number | null; clv: number | null } {
  if (!closing) return { closing_line: null, closing_price: null, closing_no_vig_probability: null, clv: null };
  const price = p.side === "over" ? closing.over_price : closing.under_price;
  if (closing.over_price === null || closing.under_price === null) {
    return { closing_line: closing.line, closing_price: price, closing_no_vig_probability: null, clv: null };
  }
  const [o, u] = devigPair(americanToImplied(closing.over_price), americanToImplied(closing.under_price));
  const nv = p.side === "over" ? o : u;
  return {
    closing_line: closing.line,
    closing_price: price,
    closing_no_vig_probability: Math.round(nv * 1e4) / 1e4,
    clv: closing.line === p.line && p.no_vig_probability !== null ? Math.round((nv - p.no_vig_probability) * 1e4) / 1e4 : null,
  };
}
