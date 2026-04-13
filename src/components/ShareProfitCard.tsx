import { useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, Download, X, TrendingUp, TrendingDown, Flame, Trophy, Calendar, Zap } from "lucide-react";
import { toPng } from "html-to-image";
import sentinelLogo from "@/assets/sentinel-logo.jpg";

interface Play {
  id: string;
  result: string;
  payout: number | null;
  stake: number;
  created_at: string;
}

interface ShareProfitCardProps {
  plays: Play[];
  onClose: () => void;
}

export function ShareProfitCard({ plays, onClose }: ShareProfitCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const stats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const todayPlays = plays.filter(p => p.created_at.startsWith(today) && p.result !== "pending");
    const todayProfit = todayPlays.reduce((sum, p) => {
      if (p.result === "win") return sum + (p.payout || 0);
      if (p.result === "loss") return sum - p.stake;
      return sum;
    }, 0);
    const todayWins = todayPlays.filter(p => p.result === "win").length;
    const todayLosses = todayPlays.filter(p => p.result === "loss").length;

    const allSettled = plays.filter(p => p.result !== "pending");
    const totalProfit = allSettled.reduce((sum, p) => {
      if (p.result === "win") return sum + (p.payout || 0);
      if (p.result === "loss") return sum - p.stake;
      return sum;
    }, 0);
    const totalWins = allSettled.filter(p => p.result === "win").length;
    const totalLosses = allSettled.filter(p => p.result === "loss").length;
    const totalPlays = totalWins + totalLosses;
    const hitRate = totalPlays > 0 ? Math.round((totalWins / totalPlays) * 100) : 0;

    // Streak
    const sorted = [...allSettled].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    let streak = 0;
    if (sorted.length) {
      const first = sorted[0].result;
      for (const p of sorted) {
        if (p.result === first) streak++;
        else break;
      }
      if (first === "loss") streak = -streak;
    }

    // Last 7 days P&L
    const week: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      const dayPlays = plays.filter(p => p.created_at.startsWith(key) && p.result !== "pending");
      week.push(dayPlays.reduce((s, p) => {
        if (p.result === "win") return s + (p.payout || 0);
        if (p.result === "loss") return s - p.stake;
        return s;
      }, 0));
    }

    return { todayProfit, todayWins, todayLosses, totalProfit, totalWins, totalLosses, hitRate, streak, week, todayPlays: todayPlays.length };
  }, [plays]);

  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, backgroundColor: "transparent" });
      const link = document.createElement("a");
      link.download = `sentinel-pnl-${new Date().toISOString().split("T")[0]}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("Failed to generate image", e);
    }
    setDownloading(false);
  };

  const handleShare = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, backgroundColor: "transparent" });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "sentinel-profit-card.png", { type: "image/png" });
      if (navigator.share) {
        await navigator.share({ files: [file], title: "My Sentinel P&L" });
      } else {
        handleDownload();
      }
    } catch (e) {
      console.error("Share failed", e);
    }
    setDownloading(false);
  };

  const maxWeek = Math.max(...stats.week.map(Math.abs), 1);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-6"
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0" style={{ background: 'hsla(228, 30%, 4%, 0.9)', backdropFilter: 'blur(12px)' }} />

        <motion.div
          initial={{ scale: 0.85, y: 30, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.9, y: 20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="relative z-10 w-full max-w-[360px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button onClick={onClose} className="absolute -top-12 right-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"
            style={{ background: 'hsla(228, 20%, 15%, 0.6)', border: '1px solid hsla(228, 20%, 25%, 0.3)' }}>
            <X className="w-4 h-4" />
          </button>

          {/* ── THE SHAREABLE CARD ── */}
          <div ref={cardRef} className="rounded-3xl overflow-hidden" style={{
            background: 'linear-gradient(160deg, hsl(228, 30%, 10%) 0%, hsl(228, 35%, 6%) 100%)',
            border: '1px solid hsla(228, 25%, 18%, 0.5)',
            boxShadow: '0 25px 60px hsla(228, 40%, 4%, 0.8)',
          }}>
            {/* Card top glow */}
            <div className="absolute top-0 left-0 right-0 h-40 opacity-[0.08] pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at top center, hsl(250 76% 62%), transparent 70%)' }} />

            {/* Header */}
            <div className="relative px-6 pt-6 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <img src={sentinelLogo} alt="Sentinel" className="w-8 h-8 rounded-xl"
                    style={{ boxShadow: '0 2px 8px hsla(228, 40%, 4%, 0.5)' }} />
                  <div>
                    <span className="text-[12px] font-extrabold tracking-[0.12em] uppercase" style={{
                      background: 'linear-gradient(135deg, hsl(250 76% 72%), hsl(210 100% 70%))',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}>Sentinel</span>
                    <p className="text-[7px] text-white/20 font-semibold tracking-wider uppercase -mt-0.5">AI Sports Analytics</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: 'hsla(228, 20%, 15%, 0.6)', border: '1px solid hsla(228, 20%, 25%, 0.2)' }}>
                  <Calendar className="w-2.5 h-2.5 text-white/25" />
                  <span className="text-[7px] font-bold text-white/25 tracking-wider">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
              </div>
            </div>

            {/* Gradient divider */}
            <div className="mx-6 h-[1px]" style={{ background: 'linear-gradient(90deg, transparent, hsla(250, 76%, 62%, 0.2), transparent)' }} />

            {/* Main PnL */}
            <div className="px-6 py-5 text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 mb-2">Today's P&L</p>
              <p className={`text-5xl font-black tabular-nums tracking-tight ${stats.todayProfit >= 0 ? "text-[hsl(158,64%,52%)]" : "text-[hsl(0,72%,51%)]"}`}
                style={{ textShadow: stats.todayProfit >= 0 ? '0 0 30px hsla(158,64%,52%,0.3)' : '0 0 30px hsla(0,72%,51%,0.3)' }}>
                {stats.todayProfit >= 0 ? "+" : "-"}${Math.abs(stats.todayProfit).toFixed(2)}
              </p>
              <div className="flex items-center justify-center gap-3 mt-2.5">
                <span className="text-[10px] font-bold text-[hsl(158,64%,52%)]">{stats.todayWins}W</span>
                <span className="text-[10px] font-bold text-white/15">·</span>
                <span className="text-[10px] font-bold text-[hsl(0,72%,51%)]">{stats.todayLosses}L</span>
                <span className="text-[10px] font-bold text-white/15">·</span>
                <span className="text-[10px] font-bold text-white/30">{stats.todayPlays} plays</span>
              </div>
            </div>

            {/* 7-day sparkline */}
            <div className="px-6 pb-4">
              <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/15 mb-2">7-Day Trend</p>
              <div className="flex items-end gap-1 h-10">
                {stats.week.map((val, i) => {
                  const h = Math.max((Math.abs(val) / maxWeek) * 32, 2);
                  return (
                    <div key={i} className="flex-1 flex items-end justify-center">
                      <div className="w-full max-w-[20px] rounded-t-sm" style={{
                        height: h,
                        background: val >= 0
                          ? `linear-gradient(180deg, hsla(158, 64%, 52%, 0.8), hsla(158, 64%, 52%, 0.2))`
                          : `linear-gradient(180deg, hsla(0, 72%, 51%, 0.8), hsla(0, 72%, 51%, 0.2))`,
                      }} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Stats grid */}
            <div className="px-6 pb-5">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: Trophy, label: "Hit Rate", value: `${stats.hitRate}%`, color: stats.hitRate >= 55 ? "hsl(158,64%,52%)" : "hsl(210,100%,60%)" },
                  { icon: TrendingUp, label: "All-Time", value: `${stats.totalProfit >= 0 ? "+" : ""}$${Math.abs(stats.totalProfit).toFixed(0)}`, color: stats.totalProfit >= 0 ? "hsl(158,64%,52%)" : "hsl(0,72%,51%)" },
                  { icon: Zap, label: "Streak", value: `${Math.abs(stats.streak)}${stats.streak >= 0 ? "W" : "L"}`, color: stats.streak >= 0 ? "hsl(158,64%,52%)" : "hsl(0,72%,51%)" },
                ].map((s, i) => (
                  <div key={s.label} className="text-center py-3 rounded-xl" style={{
                    background: 'hsla(228, 20%, 12%, 0.5)',
                    border: '1px solid hsla(228, 20%, 18%, 0.2)',
                  }}>
                    <s.icon className="w-3 h-3 mx-auto mb-1.5" style={{ color: `${s.color}60` }} />
                    <p className="text-sm font-extrabold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[7px] font-bold uppercase tracking-wider text-white/15 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-5">
              <div className="h-[1px] mb-3" style={{ background: 'linear-gradient(90deg, transparent, hsla(228, 20%, 20%, 0.3), transparent)' }} />
              <div className="flex items-center justify-between">
                <span className="text-[7px] text-white/10 font-medium">{dateStr}</span>
                <span className="text-[7px] font-bold tracking-wider" style={{
                  background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>SENTINELPROPS.COM</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 mt-5">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleDownload}
              disabled={downloading}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[13px] transition-all"
              style={{
                background: 'hsla(228, 20%, 12%, 0.8)',
                border: '1px solid hsla(228, 20%, 22%, 0.3)',
                color: 'hsl(0, 0%, 85%)',
              }}
            >
              <Download className="w-4 h-4" />
              Save
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleShare}
              disabled={downloading}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[13px] text-white transition-all"
              style={{
                background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))',
                boxShadow: '0 4px 16px hsla(250, 76%, 62%, 0.3)',
              }}
            >
              <Share2 className="w-4 h-4" />
              Share
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
