export type PickLike = {
  tier?: string | null;
  status?: string | null;
};

export const isEdgeHistoryPick = (p: PickLike): boolean => {
  const tier = String(p.tier || "").toLowerCase();
  const status = String(p.status || "").toLowerCase();
  return tier === "edge" && status !== "empty_slate";
};

export const isPicksHistoryPick = (p: PickLike): boolean => {
  const tier = String(p.tier || "").toLowerCase();
  const status = String(p.status || "").toLowerCase();
  return (
    tier !== "edge" &&
    tier !== "pass" &&
    tier !== "_pending" &&
    status !== "empty_slate"
  );
};
