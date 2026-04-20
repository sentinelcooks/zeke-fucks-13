import { useState, useRef, useEffect, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const STATUS_INFO: Record<string, { title: string; description: string; icon: string }> = {
  out: {
    title: "Out",
    icon: "🚫",
    description: "The player has been ruled out and will not participate in the upcoming game. This is a confirmed absence.",
  },
  doubtful: {
    title: "Doubtful",
    icon: "⚠️",
    description: "The player is unlikely to play (roughly 25% chance). They are dealing with a significant issue and are expected to miss the game.",
  },
  questionable: {
    title: "Questionable",
    icon: "❓",
    description: "The player's availability is uncertain (roughly 50/50). A game-time decision may be needed.",
  },
  "day-to-day": {
    title: "Day-To-Day",
    icon: "📋",
    description: "The player is managing a minor issue and is being evaluated on a daily basis. They may play depending on how they feel closer to game time.",
  },
  probable: {
    title: "Probable",
    icon: "✅",
    description: "The player is expected to play (roughly 75%+ chance). They may be dealing with a minor issue but are likely to be available.",
  },
};

function getInfo(status: string) {
  const key = status.toLowerCase().replace(/\s+/g, "-");
  return STATUS_INFO[key] || {
    title: status,
    icon: "ℹ️",
    description: `This player's current status is listed as "${status}".`,
  };
}

interface Props {
  status: string;
  colorClass: string;
  bgClass: string;
}

export const InjuryStatusBadge = memo(function InjuryStatusBadge({ status, colorClass, bgClass }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const info = getInfo(status);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  return (
    <div className="relative ml-auto" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`text-[9px] font-bold px-2 py-1 rounded-lg ${bgClass} ${colorClass} active:scale-95 transition-transform`}
      >
        {status}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 bottom-full mb-2 w-64 z-50 rounded-xl overflow-hidden"
            style={{
              background: "hsla(228, 25%, 10%, 0.97)",
              border: "1px solid hsla(228, 20%, 22%, 0.5)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 12px 40px -8px hsla(228, 50%, 4%, 0.8)",
            }}
          >
            <div className="p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{info.icon}</span>
                  <span className="text-xs font-bold text-foreground">{info.title}</span>
                </div>
                <button onClick={() => setOpen(false)} className="w-5 h-5 rounded-md flex items-center justify-center hover:bg-secondary transition-colors">
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{info.description}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
