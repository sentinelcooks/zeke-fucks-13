import { memo } from "react";
import { motion } from "framer-motion";
import sentinelLogo from "@/assets/sentinel-logo.jpg";

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
}

export const MobileHeader = memo(function MobileHeader({ title }: MobileHeaderProps) {
  const time = new Date();
  const dateStr = time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <header
      className="sticky top-0 z-40"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {/* Solid background — no frosted glass gap at top */}
      <div className="absolute inset-0" style={{
        background: 'hsl(228, 30%, 6%)',
      }} />
      {/* Bottom border gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px]"
        style={{ background: 'linear-gradient(90deg, transparent, hsla(250, 76%, 62%, 0.15), hsla(210, 100%, 60%, 0.08), transparent)' }} />

      {/* Single compact row */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <img
              src={sentinelLogo}
              alt="Sentinel"
              className="w-8 h-8 rounded-lg object-cover"
              style={{ boxShadow: '0 2px 6px hsla(228, 40%, 4%, 0.4), 0 0 0 1px hsla(228, 30%, 20%, 0.25)' }}
            />
            <motion.div
              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-[1.5px] border-background"
              style={{ background: 'hsl(158, 64%, 52%)' }}
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <div className="min-w-0">
            <motion.h1
              className="text-[15px] font-extrabold text-foreground tracking-tight truncate"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              {title}
            </motion.h1>
          </div>
        </div>

        {/* Date pill */}
        <div className="px-2 py-1 rounded-full flex items-center gap-1.5 shrink-0"
          style={{ background: 'hsla(228, 20%, 12%, 0.6)', border: '1px solid hsla(228, 20%, 20%, 0.2)' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-glow-pulse" />
          <span className="text-[8px] font-bold text-muted-foreground/65 tracking-wider uppercase">{dateStr}</span>
        </div>
      </div>
    </header>
  );
});
