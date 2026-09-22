import { normalizeDirection } from "./prop_normalization.ts";

/**
 * Which over/under side a game-total analyzer actually scored.
 *
 * `moneyline-api`'s verified MLB total model returns the side its projection
 * favours rather than the side it was asked about (`selected_direction`), so
 * the confidence it returns can belong to the opposite bet. The scanner must
 * not attach that score to the side it requested: doing so published an Over
 * read as an "Under" pick, and the Daily Edge card then disagreed with its own
 * report.
 *
 * Player props and team markets are excluded on purpose: those analyzers score
 * the side/team they were asked about, and their `decision` lean is a lean,
 * not a side swap.
 */
export function analyzerTotalSideMismatch(
  betType: string | null | undefined,
  requestedDirection: string | null | undefined,
  analyzed: Record<string, any> | null | undefined,
): { requestedSide: string; analyzerSide: string } | null {
  const bet = String(betType ?? "").toLowerCase();
  if (bet !== "total" && bet !== "over_under") return null;
  const requestedSide = normalizeDirection(requestedDirection);
  if (requestedSide !== "over" && requestedSide !== "under") return null;
  const raw = analyzed?.selected_direction ?? analyzed?.selectedSide ?? analyzed?.decision?.winning_side;
  const analyzerSide = normalizeDirection(typeof raw === "string" ? raw : null);
  if (analyzerSide !== "over" && analyzerSide !== "under") return null;
  return analyzerSide === requestedSide ? null : { requestedSide, analyzerSide };
}
