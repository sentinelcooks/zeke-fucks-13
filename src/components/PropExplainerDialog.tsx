import { useState, useEffect, useRef } from "react";
import { Lightbulb, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import logo from "@/assets/sentinel-lock.jpg";

// Client-side cache to avoid re-fetching the same prop
const explanationCache = new Map<string, { explanation: string; example: string }>();

interface PropExplainerDialogProps {
  propValue: string;
  propLabel: string;
  sport: string;
  bettingLevel: string;
  isOpen: boolean;
  onClose: () => void;
}

export function PropExplainerDialog({ propValue, propLabel, sport, bettingLevel, isOpen, onClose }: PropExplainerDialogProps) {
  const [explanation, setExplanation] = useState("");
  const [example, setExample] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen || !propValue) return;

    // Check client cache first
    const cacheKey = `${propValue}_${sport}_${bettingLevel}`;
    const cached = explanationCache.get(cacheKey);
    if (cached) {
      setExplanation(cached.explanation);
      setExample(cached.example);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    supabase.functions.invoke("prop-explainer", {
      body: { prop_value: propValue, prop_label: propLabel, sport, betting_level: bettingLevel },
    }).then(({ data, error: fnError }) => {
      if (controller.signal.aborted) return;
      if (fnError) throw fnError;
      setExplanation(data.explanation || "");
      setExample(data.example || "");
      explanationCache.set(cacheKey, { explanation: data.explanation, example: data.example });
    }).catch((e: any) => {
      if (controller.signal.aborted) return;
      console.error("Prop explainer error:", e);
      setError("Couldn't load explanation. Try again.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [isOpen, propValue, propLabel, sport, bettingLevel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(145deg, hsla(228, 25%, 12%, 0.95), hsla(228, 25%, 8%, 0.98))",
              border: "1px solid hsla(250, 76%, 62%, 0.15)",
              boxShadow: "0 25px 50px -12px hsla(0, 0%, 0%, 0.5), 0 0 40px -10px hsla(250, 76%, 62%, 0.15)",
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, hsla(250,76%,62%,0.3), transparent)" }} />

            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-all z-10"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl overflow-hidden shrink-0"
                    style={{ border: "1px solid hsla(250, 76%, 62%, 0.2)" }}
                >
                    <img src={logo} alt="Sentinel" className="w-full h-full object-cover" draggable={false} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">What is {propLabel}?</h3>
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Powered by Sentinel AI</p>
                </div>
              </div>

              {/* Content */}
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                <>
                  <p className="text-xs text-foreground/80 leading-relaxed">{explanation}</p>

                  <div
                    className="rounded-xl p-3.5 space-y-1.5"
                    style={{
                      background: "linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(158, 64%, 52%, 0.03))",
                      border: "1px solid hsla(158, 64%, 52%, 0.12)",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Lightbulb className="w-3 h-3 text-emerald-400/80" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70">Example</span>
                    </div>
                    <p className="text-[11px] text-foreground/70 leading-relaxed">{example}</p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook to manage auto-show for beginners/intermediates
export function usePropExplainerAutoShow(bettingLevel: string | null) {
  const shouldAutoShow = bettingLevel === "beginner" || bettingLevel === "intermediate";

  const hasSeenProp = (propValue: string): boolean => {
    if (!shouldAutoShow) return true;
    try {
      const seen = JSON.parse(localStorage.getItem("sentinel_seen_props") || "[]");
      return seen.includes(propValue);
    } catch {
      return false;
    }
  };

  const markPropSeen = (propValue: string) => {
    try {
      const seen = JSON.parse(localStorage.getItem("sentinel_seen_props") || "[]");
      if (!seen.includes(propValue)) {
        seen.push(propValue);
        localStorage.setItem("sentinel_seen_props", JSON.stringify(seen));
      }
    } catch {}
  };

  return { shouldAutoShow, hasSeenProp, markPropSeen };
}
