import { useNavigate, useLocation } from "react-router-dom";
import { useParlaySlip } from "@/contexts/ParlaySlipContext";
import { Layers, Trash2, X, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

export function FloatingParlaySlip() {
  const { legs, removeLeg, clearSlip } = useParlaySlip();
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);

  // Show on ALL pages as long as there are legs — including parlay page
  if (legs.length === 0) return null;

  const isOnParlayPage = location.pathname === "/dashboard/parlay";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="fixed right-4 z-40 max-w-[320px]"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}
      >
        {/* Expanded view */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              className="mb-2 rounded-2xl overflow-hidden shadow-2xl shadow-black/50"
              style={{
                background: "linear-gradient(135deg, hsla(228, 30%, 10%, 0.97), hsla(228, 30%, 6%, 0.97))",
                border: "1px solid hsla(250, 76%, 62%, 0.15)",
                backdropFilter: "blur(24px)",
              }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/10">
                <span className="text-[10px] font-bold uppercase tracking-wider text-accent">
                  Slip ({legs.length} leg{legs.length !== 1 ? "s" : ""})
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={clearSlip} className="text-[9px] text-muted-foreground/65 hover:text-destructive transition-colors">
                    Clear
                  </button>
                  <button onClick={() => setExpanded(false)}>
                    <X className="w-3.5 h-3.5 text-muted-foreground/65 hover:text-foreground transition-colors" />
                  </button>
                </div>
              </div>
              <div className="px-4 py-2 space-y-1 max-h-[200px] overflow-y-auto">
                {legs.map((leg) => (
                  <div key={leg.id} className="flex items-center justify-between py-2 border-b border-border/10 last:border-0">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[11px] font-bold text-foreground truncate">{leg.player}</p>
                      <p className="text-[10px] text-muted-foreground/60">
                        {leg.overUnder.toUpperCase()} {leg.line} {leg.propType.toUpperCase()}
                      </p>
                    </div>
                    <button onClick={() => removeLeg(leg.id)} className="ml-2 shrink-0">
                      <Trash2 className="w-3 h-3 text-muted-foreground/55 hover:text-destructive transition-colors" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-border/10">
                {isOnParlayPage ? (
                  <button
                    onClick={() => setExpanded(false)}
                    className="w-full py-2.5 rounded-xl text-[11px] font-bold text-white/70 tracking-wider border border-border/20"
                    style={{ background: "hsla(228, 30%, 12%, 0.8)" }}
                  >
                    CLOSE
                  </button>
                ) : (
                  <button
                    onClick={() => navigate("/dashboard/parlay")}
                    className="w-full py-2.5 rounded-xl text-[11px] font-bold text-white tracking-wider"
                    style={{ background: "linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))" }}
                  >
                    GO TO PARLAY BUILDER →
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pill button */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl shadow-black/40 ml-auto"
          style={{
            background: "linear-gradient(135deg, hsla(250, 76%, 62%, 0.9), hsla(210, 100%, 60%, 0.9))",
            border: "1px solid hsla(250, 76%, 62%, 0.3)",
          }}
        >
          <Layers className="w-4 h-4 text-white" />
          <span className="text-[12px] font-bold text-white">{legs.length}</span>
          <ChevronUp className={`w-3.5 h-3.5 text-white/70 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}
