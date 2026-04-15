import { motion } from "framer-motion";

interface HitRateRingProps {
  rate: number;
  hits: number;
  total: number;
  label: string;
  delay?: number;
}

function getRingColor(rate: number): string {
  if (rate >= 65) return "hsl(160, 100%, 45%)";
  if (rate >= 50) return "hsl(215, 90%, 60%)";
  if (rate >= 35) return "hsl(40, 100%, 55%)";
  return "hsl(0, 85%, 62%)";
}

function getTextColor(rate: number): string {
  if (rate >= 65) return "text-nba-green";
  if (rate >= 50) return "text-nba-blue";
  if (rate >= 35) return "text-nba-yellow";
  return "text-nba-red";
}

export function HitRateRing({ rate, hits, total, label, delay = 0 }: HitRateRingProps) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (rate / 100) * circumference;
  const color = getRingColor(rate);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="flex flex-col items-center min-w-0 flex-shrink-0"
    >
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="hsl(220, 15%, 12%)" strokeWidth="5" />
          <motion.circle
            cx="40" cy="40" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ delay: delay + 0.3, duration: 0.8, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-sm font-black tabular-nums ${getTextColor(rate)}`}>{rate}%</span>
        </div>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1.5">{label}</span>
      <span className="text-[9px] text-muted-foreground">{hits}/{total}</span>
    </motion.div>
  );
}
