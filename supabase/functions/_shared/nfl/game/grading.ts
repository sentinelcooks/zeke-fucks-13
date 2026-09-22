/**
 * NFL GAME EDGE ENGINE — settlement + CLV (pure).
 *
 * CLV is measured in no-vig probability at the SAME line only:
 *   clv = closing no-vig P(side) − no-vig P(side) when the pick was made.
 * If the line moved, the probability CLV is left null (a points→probability
 * conversion would be a model assumption, not a market fact); the closing
 * line itself is stored so line movement stays visible.
 */

import { americanToImplied, devigPair } from "../../prob_math.ts";
import type { NflMarketQuote } from "../data/types.ts";

export interface GamePredictionToGrade {
  market_type: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line: number | null; // from this side's perspective
  market_price: number | null;
  no_vig_probability: number | null;
}

export type Result = "win" | "loss" | "push" | "void";

export function settleGame(p: GamePredictionToGrade, homeScore: number, awayScore: number): { result: Result; profit_units: number } {
  let result: Result;
  const margin = homeScore - awayScore;
  if (p.market_type === "moneyline") {
    result = margin === 0 ? "push" : (p.side === "home") === (margin > 0) ? "win" : "loss";
  } else if (p.market_type === "spread") {
    const sideMargin = p.side === "home" ? margin : -margin;
    const adj = sideMargin + (p.line ?? 0);
    result = adj === 0 ? "push" : adj > 0 ? "win" : "loss";
  } else {
    const diff = homeScore + awayScore - (p.line ?? 0);
    result = diff === 0 ? "push" : (p.side === "over") === (diff > 0) ? "win" : "loss";
  }
  const price = p.market_price ?? -110;
  const win = price > 0 ? price / 100 : 100 / -price;
  return { result, profit_units: result === "win" ? round(win) : result === "loss" ? -1 : 0 };
}

export function gameClv(p: GamePredictionToGrade, closing: NflMarketQuote | null): {
  closing_line: number | null;
  closing_price: number | null;
  closing_no_vig_probability: number | null;
  clv: number | null;
} {
  if (!closing) return { closing_line: null, closing_price: null, closing_no_vig_probability: null, clv: null };
  const isA = p.side === "home" || p.side === "over";
  const [a, b] = devigPair(americanToImplied(closing.current.price_a), americanToImplied(closing.current.price_b));
  const nv = isA ? a : b;
  const lineA = closing.current.line;
  const closingLine = p.market_type === "moneyline" ? null : lineA === null ? null : p.side === "away" ? -lineA : lineA;
  const sameLine = p.market_type === "moneyline" || closingLine === p.line;
  return {
    closing_line: closingLine,
    closing_price: isA ? closing.current.price_a : closing.current.price_b,
    closing_no_vig_probability: round(nv),
    clv: sameLine && p.no_vig_probability !== null ? round(nv - p.no_vig_probability) : null,
  };
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;
