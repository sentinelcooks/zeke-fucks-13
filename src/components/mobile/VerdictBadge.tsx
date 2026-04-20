import { motion } from "framer-motion";

interface VerdictBadgeProps {
  confidence: number;
  verdict: string;
  overUnder: string;
  line: number;
  propDisplay: string;
}

function getVerdictTheme(v: string) {
  switch (v) {
    case "STRONG PICK":
    case "STRONG BET":
    case "STRONG":
      return {
        bg: "bg-nba-green-dim",
        border: "border-[hsla(158,64%,52%,0.2)]",
        text: "text-nba-green",
        glow: "glow-green",
        gradient: "from-[hsla(158,64%,52%,0.15)] to-transparent",
      };
    case "LEAN":
      return {
        bg: "bg-nba-blue-dim",
        border: "border-[hsla(211,100%,60%,0.2)]",
        text: "text-nba-blue",
        glow: "glow-blue",
        gradient: "from-[hsla(211,100%,60%,0.15)] to-transparent",
      };
    case "RISKY":
      return {
        bg: "bg-nba-yellow-dim",
        border: "border-[hsla(43,96%,56%,0.2)]",
        text: "text-nba-yellow",
        glow: "",
        gradient: "from-[hsla(43,96%,56%,0.1)] to-transparent",
      };
    case "DO NOT BET":
      return {
        bg: "bg-nba-red-dim",
        border: "border-destructive/30",
        text: "text-nba-red",
        glow: "glow-red",
        gradient: "from-[hsla(0,72%,51%,0.2)] to-transparent",
      };
    default:
      return {
        bg: "bg-nba-red-dim",
        border: "border-destructive/20",
        text: "text-nba-red",
        glow: "glow-red",
        gradient: "from-[hsla(0,72%,51%,0.15)] to-transparent",
      };
  }
}

export function VerdictBadge({ confidence, verdict, overUnder, line, propDisplay }: VerdictBadgeProps) {
  const theme = getVerdictTheme(verdict);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`relative rounded-2xl overflow-hidden border ${theme.border} ${theme.glow} p-6 text-center`}
      style={{ background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)' }}
    >
      {/* Gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-b ${theme.gradient} pointer-events-none`} />
      
      <div className="relative z-10">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 400, damping: 20 }}
          className={`text-5xl font-black ${theme.text} tabular-nums`}
        >
          {Math.round(confidence)}%
        </motion.div>
        <div className={`text-sm font-black tracking-[3px] mt-1 ${theme.text}`}>
          {verdict}
        </div>
        <div className="text-xs text-muted-foreground/60 mt-2.5 font-medium">
          {overUnder.toUpperCase()} {line} {propDisplay}
        </div>
      </div>
    </motion.div>
  );
}
