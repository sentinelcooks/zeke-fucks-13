import { isResultFinal } from "./gameDate";

export type SettlementState = "won" | "lost" | "push" | "pending";

export interface Settlement {
  state: SettlementState;
  /** Badge copy shown on the lineup card. */
  label: string;
  settled: boolean;
}

const WON = new Set(["hit", "win"]);
const LOST = new Set(["miss", "loss"]);
/** Withdrawn picks settle like a push: stake back, excluded from the record. */
const VOIDED = new Set(["void", "voided"]);

/**
 * Maps a pick's stored grade onto the Today's Edge card's settled state.
 *
 * grade-picks writes `hit` / `miss` / `push` (with `win` / `loss` accepted as
 * legacy synonyms — see FINAL_RESULTS in gameDate.ts). Anything else, null
 * included, is still live.
 */
export function settlementOf(pick: { result?: string | null }): Settlement {
  const raw = String(pick?.result ?? "").toLowerCase().trim();

  if (!isResultFinal(raw)) return { state: "pending", label: "", settled: false };
  if (WON.has(raw)) return { state: "won", label: "WON", settled: true };
  if (LOST.has(raw)) return { state: "lost", label: "LOST", settled: true };
  if (VOIDED.has(raw)) return { state: "push", label: "VOID", settled: true };
  return { state: "push", label: "PUSH", settled: true };
}

/**
 * Hours after first pitch by which a game is certainly finished.
 *
 * Deliberately generous — extra innings, long rain delays. The point is to
 * distinguish "still playing" from "finished, and this pick will never settle",
 * not to predict the final out.
 */
const GAME_SETTLED_AFTER_HOURS = 6;

/**
 * True when a pick is still unsettled but its game finished long ago.
 *
 * These do exist and are not a grading bug: a player named in the projected
 * lineup who is then scratched never appears in the box score, so there is no
 * stat to grade against and grade-picks correctly refuses to invent one.
 *
 * The UI has to tell them apart from live games, because labelling a finished
 * game "in progress" is simply false — it sends the user looking for a result
 * that is never coming.
 */
export function isAwaitingGame(
  pick: { result?: string | null; commence_time?: string | null },
  now: number = Date.now(),
): boolean {
  if (settlementOf(pick).settled) return false;
  const start = pick?.commence_time ? Date.parse(pick.commence_time) : NaN;
  // Unknown start time: assume it may still be live rather than declaring it dead.
  if (!Number.isFinite(start)) return true;
  return now - start < GAME_SETTLED_AFTER_HOURS * 3_600_000;
}

/** Pending, but the game is over — it will never settle. */
export function isUnresolved(
  pick: { result?: string | null; commence_time?: string | null },
  now: number = Date.now(),
): boolean {
  return !settlementOf(pick).settled && !isAwaitingGame(pick, now);
}

export interface SettlementPalette {
  accent: string;
  /** Translucent fill for the badge chip. */
  chip: string;
  /** Card border tint once settled. */
  border: string;
  /** Very faint wash across the card so a settled pick reads differently. */
  wash: string;
}

// Reuses the greens/reds already used by Yesterday's Edge Results so a pick
// looks the same the moment it settles as it does in tomorrow's recap.
export const SETTLEMENT_PALETTE: Record<Exclude<SettlementState, "pending">, SettlementPalette> = {
  won: {
    accent: "hsl(142 71% 45%)",
    chip: "hsla(142, 71%, 45%, 0.14)",
    border: "hsla(142, 71%, 45%, 0.38)",
    wash: "hsla(142, 71%, 45%, 0.05)",
  },
  lost: {
    accent: "hsl(0 84% 60%)",
    chip: "hsla(0, 84%, 60%, 0.13)",
    border: "hsla(0, 84%, 60%, 0.34)",
    wash: "hsla(0, 84%, 60%, 0.045)",
  },
  push: {
    accent: "hsl(45 93% 58%)",
    chip: "hsla(45, 93%, 58%, 0.14)",
    border: "hsla(45, 93%, 58%, 0.36)",
    wash: "hsla(45, 93%, 58%, 0.05)",
  },
};

/**
 * "3 RBI" / "1.5 Hits" — the settled number next to the line, when grade-picks
 * recorded one. Game bets (spread/total/moneyline) grade without a per-player
 * actual, so they return null and the card just shows the badge.
 */
export function actualValueLabel(pick: {
  actual_value?: number | string | null;
}): string | null {
  const raw = pick?.actual_value;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : String(value);
}
