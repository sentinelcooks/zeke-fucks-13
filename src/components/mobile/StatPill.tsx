import { motion } from "framer-motion";

interface StatPillProps {
  label: string;
  value: string | number;
  subtext?: string;
  color?: "green" | "red" | "blue" | "yellow" | "default";
  delay?: number;
}

const colorMap = {
  green: "text-nba-green",
  red: "text-nba-red",
  blue: "text-nba-blue",
  yellow: "text-nba-yellow",
  default: "text-accent",
};

export function StatPill({ label, value, subtext, color = "default", delay = 0 }: StatPillProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="vision-card p-3 text-center"
    >
      <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">{label}</span>
      <span className={`block text-xl font-black tabular-nums ${colorMap[color]}`}>
        {value ?? "--"}
      </span>
      {subtext && <span className="block text-[9px] text-muted-foreground/50 mt-0.5">{subtext}</span>}
    </motion.div>
  );
}
