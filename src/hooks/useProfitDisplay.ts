import { useState, useEffect, useCallback } from "react";
import {
  formatProfit,
  getActiveUnitSize,
  readUnitSettings,
  readProfitDisplayMode,
  type ProfitDisplayMode,
} from "@/lib/profitFormat";

interface ProfitDisplay {
  mode: ProfitDisplayMode;
  unitSize: number | null;
  format: (valueDollars: number) => string;
}

function snapshot(): ProfitDisplay {
  const mode = readProfitDisplayMode();
  const settings = readUnitSettings();
  const unitSize = getActiveUnitSize(settings);
  return {
    mode,
    unitSize,
    format: (v: number) => formatProfit(v, mode, unitSize),
  };
}

/**
 * Subscribe to localStorage changes (cross-tab via `storage` event,
 * same-tab via the custom `sentinel:settings-changed` event) and return
 * the current profit display configuration.
 */
export function useProfitDisplay(): ProfitDisplay {
  const [state, setState] = useState<ProfitDisplay>(snapshot);

  const refresh = useCallback(() => {
    setState(snapshot());
  }, []);

  useEffect(() => {
    window.addEventListener("storage", refresh);
    window.addEventListener("sentinel:settings-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("sentinel:settings-changed", refresh);
    };
  }, [refresh]);

  return state;
}
