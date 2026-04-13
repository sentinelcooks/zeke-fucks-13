import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Calendar, Share2 } from "lucide-react";
import { ShareProfitCard } from "@/components/ShareProfitCard";

interface Play {
  id: string;
  result: string;
  payout: number | null;
  stake: number;
  created_at: string;
}

interface PnLCalendarProps {
  plays: Play[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function PnLCalendar({ plays }: PnLCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showShareCard, setShowShareCard] = useState(false);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const dailyPnL = useMemo(() => {
    const map: Record<string, number> = {};
    plays.forEach(p => {
      if (p.result === "pending") return;
      const day = p.created_at.split("T")[0];
      if (!map[day]) map[day] = 0;
      if (p.result === "win") map[day] += (p.payout || 0);
      else if (p.result === "loss") map[day] -= p.stake;
    });
    return map;
  }, [plays]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [year, month]);

  const monthTotal = useMemo(() => {
    let total = 0;
    Object.entries(dailyPnL).forEach(([date, val]) => {
      const d = new Date(date);
      if (d.getFullYear() === year && d.getMonth() === month) total += val;
    });
    return total;
  }, [dailyPnL, year, month]);

  const winDays = useMemo(() => {
    let count = 0;
    Object.entries(dailyPnL).forEach(([date, val]) => {
      const d = new Date(date);
      if (d.getFullYear() === year && d.getMonth() === month && val > 0) count++;
    });
    return count;
  }, [dailyPnL, year, month]);

  const lossDays = useMemo(() => {
    let count = 0;
    Object.entries(dailyPnL).forEach(([date, val]) => {
      const d = new Date(date);
      if (d.getFullYear() === year && d.getMonth() === month && val < 0) count++;
    });
    return count;
  }, [dailyPnL, year, month]);

  const maxVal = useMemo(() => {
    let max = 1;
    Object.entries(dailyPnL).forEach(([date, val]) => {
      const d = new Date(date);
      if (d.getFullYear() === year && d.getMonth() === month) max = Math.max(max, Math.abs(val));
    });
    return max;
  }, [dailyPnL, year, month]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="vision-card p-5 relative overflow-hidden"
      >
        {/* Background glow */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-[0.04] pointer-events-none"
          style={{ background: 'radial-gradient(circle, hsl(250 76% 62%), transparent 70%)' }} />

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[hsl(250,76%,62%)] to-[hsl(280,70%,55%)] flex items-center justify-center shadow-lg"
              style={{ boxShadow: '0 4px 14px -2px hsla(250,76%,62%,0.3)' }}>
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-foreground">P&L Calendar</p>
              <p className="text-[9px] text-muted-foreground/65">Daily profit & loss</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Share button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowShareCard(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/65 hover:text-accent transition-all"
              style={{ background: 'hsla(228, 20%, 12%, 0.5)', border: '1px solid hsla(228, 20%, 20%, 0.2)' }}
            >
              <Share2 className="w-3.5 h-3.5" />
            </motion.button>
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: 'hsla(228, 20%, 12%, 0.5)', border: '1px solid hsla(228, 20%, 20%, 0.2)' }}>
              {monthTotal >= 0 ? (
                <TrendingUp className="w-3 h-3 text-nba-green" />
              ) : (
                <TrendingDown className="w-3 h-3 text-nba-red" />
              )}
              <span className={`text-[11px] font-extrabold tabular-nums ${monthTotal >= 0 ? "text-nba-green" : "text-nba-red"}`}>
                {monthTotal >= 0 ? "+" : ""}${Math.abs(monthTotal).toFixed(0)}
              </span>
            </div>
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/65 hover:text-foreground transition-colors active:scale-90"
            style={{ background: 'hsla(228, 20%, 12%, 0.4)', border: '1px solid hsla(228, 20%, 20%, 0.15)' }}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence mode="wait">
            <motion.span
              key={`${year}-${month}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="text-[12px] font-bold text-foreground tracking-wide"
            >
              {MONTHS[month]} {year}
            </motion.span>
          </AnimatePresence>
          <button onClick={nextMonth} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/65 hover:text-foreground transition-colors active:scale-90"
            style={{ background: 'hsla(228, 20%, 12%, 0.4)', border: '1px solid hsla(228, 20%, 20%, 0.15)' }}>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS.map((d, i) => (
            <div key={i} className="text-center text-[8px] font-bold text-muted-foreground/50 uppercase tracking-widest py-0.5">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} className="aspect-square" />;

            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const pnl = dailyPnL[dateStr] || 0;
            const hasData = dailyPnL[dateStr] !== undefined;
            const intensity = hasData ? Math.min(Math.abs(pnl) / maxVal, 1) : 0;
            const isTodayDate = isToday(day);

            let bgStyle: React.CSSProperties = {};
            let textColor = "text-muted-foreground/65";

            if (hasData && pnl > 0) {
              bgStyle = {
                background: `hsla(158, 64%, 52%, ${0.06 + intensity * 0.24})`,
                boxShadow: intensity > 0.5 ? `inset 0 0 12px hsla(158, 64%, 52%, ${intensity * 0.12}), 0 0 8px hsla(158, 64%, 52%, ${intensity * 0.08})` : undefined,
              };
              textColor = "text-nba-green";
            } else if (hasData && pnl < 0) {
              bgStyle = {
                background: `hsla(0, 72%, 51%, ${0.06 + intensity * 0.24})`,
                boxShadow: intensity > 0.5 ? `inset 0 0 12px hsla(0, 72%, 51%, ${intensity * 0.12}), 0 0 8px hsla(0, 72%, 51%, ${intensity * 0.08})` : undefined,
              };
              textColor = "text-nba-red";
            }

            return (
              <motion.div
                key={day}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.008, duration: 0.2 }}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center relative cursor-default transition-all
                  ${isTodayDate ? "ring-1 ring-accent/30" : ""}
                `}
                style={bgStyle}
              >
                <span className={`text-[10px] font-bold tabular-nums ${isTodayDate ? "text-accent" : hasData ? textColor : "text-muted-foreground/45"}`}>
                  {day}
                </span>
                {hasData && (
                  <span className={`text-[6.5px] font-extrabold tabular-nums mt-0.5 ${textColor}`}>
                    {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(0)}
                  </span>
                )}
                {isTodayDate && (
                  <div className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-accent" />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Footer stats */}
        <div className="h-[1px] my-3.5" style={{ background: 'linear-gradient(90deg, transparent, hsla(228, 18%, 20%, 0.4), transparent)' }} />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ background: 'hsla(158, 64%, 52%, 0.35)' }} />
              <span className="text-[8px] text-muted-foreground/55 font-semibold">{winDays} green</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ background: 'hsla(0, 72%, 51%, 0.35)' }} />
              <span className="text-[8px] text-muted-foreground/55 font-semibold">{lossDays} red</span>
            </div>
          </div>
          <span className="text-[8px] text-muted-foreground/45 font-medium tabular-nums">
            {winDays + lossDays > 0 ? `${Math.round((winDays / (winDays + lossDays)) * 100)}% win rate` : "No data"}
          </span>
        </div>
      </motion.div>

      {/* Share Card Modal */}
      {showShareCard && (
        <ShareProfitCard plays={plays} onClose={() => setShowShareCard(false)} />
      )}
    </>
  );
}
