import { useState, useEffect } from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useParlaySlip, type ParlaySlipLeg } from "@/contexts/ParlaySlipContext";
import { americanToDecimal } from "@/utils/oddsFormat";
import { fetchPlayerOdds } from "@/services/oddsApi";
import { getSportsbookInfo } from "@/utils/sportsbookLogos";
import { toast } from "@/hooks/use-toast";
import { Layers, Loader2 } from "lucide-react";

export interface SlipSheetPick {
  sport: ParlaySlipLeg["sport"];
  player: string;
  propType: string;
  line: string;
  overUnder: "over" | "under";
  opponent?: string;
  odds: number;
  confidence?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pick: SlipSheetPick | null;
}

export function AddToSlipSheet({ open, onOpenChange, pick }: Props) {
  const { addLeg } = useParlaySlip();
  const [stake, setStake] = useState("");
  const [liveOdds, setLiveOdds] = useState<number | null>(null);
  const [bestBook, setBestBook] = useState<string | null>(null);
  const [loadingOdds, setLoadingOdds] = useState(false);

  useEffect(() => {
    if (open) {
      setStake("");
      setLiveOdds(null);
      setBestBook(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !pick) return;
    let cancelled = false;
    setLoadingOdds(true);

    fetchPlayerOdds(pick.player, pick.propType, pick.overUnder, pick.sport?.toLowerCase())
      .then((data) => {
        if (cancelled) return;
        const books: Array<{ book: string; odds: number; line: number }> = data?.books ?? [];
        if (books.length > 0) {
          // Best = highest odds (most favorable to bettor)
          const best = books.reduce((a, b) => (b.odds > a.odds ? b : a), books[0]);
          setLiveOdds(best.odds);
          setBestBook(best.book);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingOdds(false);
      });

    return () => { cancelled = true; };
  }, [open, pick]);

  if (!pick) return null;

  const displayOdds = liveOdds ?? pick.odds;
  const decOdds = americanToDecimal(displayOdds);
  const stakeNum = parseFloat(stake) || 0;
  const payout = (stakeNum * decOdds).toFixed(2);
  const oddsLabel = displayOdds > 0 ? `+${displayOdds}` : `${displayOdds}`;
  const bookInfo = bestBook ? getSportsbookInfo(bestBook) : null;

  const handleConfirm = () => {
    addLeg({
      sport: pick.sport,
      player: pick.player,
      propType: pick.propType,
      line: pick.line,
      overUnder: pick.overUnder,
      opponent: pick.opponent,
      odds: displayOdds,
      confidence: pick.confidence,
    });
    onOpenChange(false);
    toast({ title: "Added to slip", description: `${pick.player} — ${pick.overUnder.toUpperCase()} ${pick.line} ${pick.propType}` });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="border-0 focus:outline-none"
        style={{ background: "#111327", borderRadius: "20px 20px 0 0" }}
      >
        <div className="px-5 pb-6 pt-2">
          {/* Pick summary */}
          <div className="rounded-2xl px-4 py-4 mb-5" style={{ background: "hsla(250, 30%, 18%, 0.6)", border: "1px solid hsla(250, 40%, 30%, 0.25)" }}>
            <p className="text-[15px] font-bold text-foreground">{pick.player}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: pick.overUnder === "over" ? "#22c55e" : "#ef4444" }}>
                {pick.overUnder}
              </span>
              <span className="text-[13px] font-bold text-foreground">{pick.line}</span>
              <span className="text-[11px] text-muted-foreground uppercase">{pick.propType}</span>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] text-muted-foreground">Best Odds</span>
              {loadingOdds ? (
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
              ) : (
                <>
                  <span className="text-[13px] font-bold text-accent">{oddsLabel}</span>
                  {bookInfo && (
                    <div className="flex items-center gap-1.5 ml-1">
                      {bookInfo.logo ? (
                        <img src={bookInfo.logo} alt={bookInfo.label} className="w-4 h-4 rounded-sm object-contain" />
                      ) : (
                        <span className="text-[9px] font-bold rounded px-1 py-0.5" style={{ background: bookInfo.color, color: "#fff" }}>
                          {bookInfo.abbrev}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">{bookInfo.label}</span>
                    </div>
                  )}
                </>
              )}
              {pick.opponent && (
                <>
                  <span className="text-[11px] text-muted-foreground">vs</span>
                  <span className="text-[12px] text-foreground">{pick.opponent}</span>
                </>
              )}
            </div>
          </div>

          {/* Stake input */}
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
            Stake
          </label>
          <div className="relative mb-2">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-muted-foreground">$</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-full h-12 rounded-xl pl-8 pr-4 text-[16px] font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              style={{ background: "hsla(250, 30%, 14%, 0.8)", border: "1px solid hsla(250, 40%, 30%, 0.3)" }}
            />
          </div>

          {/* Payout */}
          <div className="flex items-center justify-between px-1 mb-5">
            <span className="text-[11px] text-muted-foreground">Potential Payout</span>
            <span className="text-[15px] font-bold" style={{ color: "#22d3ee" }}>
              ${stakeNum > 0 ? payout : "0.00"}
            </span>
          </div>

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            className="w-full py-4 rounded-xl font-bold text-white text-[13px] tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #7c6ff7, #22d3ee)" }}
          >
            <Layers className="w-4 h-4" />
            Add to Slip
          </button>

          {/* Cancel */}
          <button
            onClick={() => onOpenChange(false)}
            className="w-full py-3 mt-2 rounded-xl text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
