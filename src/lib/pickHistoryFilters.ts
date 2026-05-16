import { isTodayGamePick, isResultFinal, type GameDateLike } from "./gameDate";

export type PickLike = {
  tier?: string | null;
  status?: string | null;
  result?: string | null;
} & GameDateLike;

export const isEdgeHistoryPick = (p: PickLike): boolean => {
  const tier = String(p.tier ?? "").toLowerCase().trim();
  const status = String(p.status ?? "").toLowerCase().trim();
  return tier === "edge" && status !== "empty_slate";
};

export const isPicksHistoryPick = (p: PickLike): boolean => {
  const tier = String(p.tier ?? "").toLowerCase().trim();
  const status = String(p.status ?? "").toLowerCase().trim();
  if (tier === "edge") return false;
  if (tier === "_pending") return false;
  if (status === "empty_slate") return false;
  return true;
};

// True for a pick whose actual game is today in America/New_York and whose
// result is not yet final. Used by Today's Edge and the public Picks tab.
export const isActiveTodayPick = (p: PickLike): boolean =>
  isTodayGamePick(p) && !isResultFinal(p.result);
