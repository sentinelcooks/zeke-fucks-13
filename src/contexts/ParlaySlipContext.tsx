import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface ParlaySlipLeg {
  id: string;
  sport: "NBA" | "MLB" | "NHL" | "UFC" | "NFL";
  player: string;
  propType: string;
  line: string;
  overUnder: "over" | "under";
  opponent?: string;
  odds: number;
  confidence?: number;
}

interface ParlaySlipContextType {
  legs: ParlaySlipLeg[];
  addLeg: (leg: Omit<ParlaySlipLeg, "id">) => void;
  removeLeg: (id: string) => void;
  clearSlip: () => void;
  isInSlip: (player: string, propType: string, line: string) => boolean;
}

const ParlaySlipContext = createContext<ParlaySlipContextType | null>(null);

export function ParlaySlipProvider({ children }: { children: ReactNode }) {
  const [legs, setLegs] = useState<ParlaySlipLeg[]>([]);

  const addLeg = useCallback((leg: Omit<ParlaySlipLeg, "id">) => {
    setLegs((prev) => {
      if (prev.some((l) => l.player === leg.player && l.propType === leg.propType && l.line === leg.line)) return prev;
      return [...prev, { ...leg, id: crypto.randomUUID() }];
    });
  }, []);

  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clearSlip = useCallback(() => setLegs([]), []);

  const isInSlip = useCallback(
    (player: string, propType: string, line: string) =>
      legs.some((l) => l.player === player && l.propType === propType && l.line === line),
    [legs]
  );

  return (
    <ParlaySlipContext.Provider value={{ legs, addLeg, removeLeg, clearSlip, isInSlip }}>
      {children}
    </ParlaySlipContext.Provider>
  );
}

export function useParlaySlip() {
  const ctx = useContext(ParlaySlipContext);
  if (!ctx) throw new Error("useParlaySlip must be used within ParlaySlipProvider");
  return ctx;
}
