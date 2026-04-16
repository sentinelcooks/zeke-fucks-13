import { useState, useRef, useEffect } from "react";
import {
  Target, Shield, Hand, Crosshair, Zap, Trophy, Swords,
  CircleDot, Timer, Activity, Gauge, Star, Flame,
} from "lucide-react";

const SPORT_BET_TYPES: Record<string, { label: string; aliases: string[]; icon: typeof Target }[]> = {
  nba: [
    { label: "Points", aliases: ["pts", "pt", "scoring"], icon: Target },
    { label: "Rebounds", aliases: ["reb", "rebs", "rbs", "boards"], icon: Shield },
    { label: "Assists", aliases: ["ast", "asts", "dimes"], icon: Hand },
    { label: "3-Pointers", aliases: ["3pt", "3pm", "threes", "3s", "triples", "3-pt", "3 pointers"], icon: Crosshair },
    { label: "Steals", aliases: ["stl", "stls"], icon: Zap },
    { label: "Blocks", aliases: ["blk", "blks", "swats"], icon: Shield },
    { label: "PRA", aliases: ["pts+reb+ast", "p+r+a", "combo", "pra combo"], icon: Activity },
    { label: "Pts + Reb", aliases: ["pr", "p+r", "points rebounds"], icon: Gauge },
    { label: "Pts + Ast", aliases: ["pa", "p+a", "points assists"], icon: Gauge },
    { label: "Turnovers", aliases: ["to", "tov", "tovs"], icon: Flame },
    { label: "1Q Points", aliases: ["1q pts", "first quarter points", "1q scoring"], icon: Timer },
    { label: "1Q Rebounds", aliases: ["1q reb", "first quarter rebounds", "1q boards"], icon: Timer },
    { label: "1Q Assists", aliases: ["1q ast", "first quarter assists", "1q dimes"], icon: Timer },
    { label: "1Q 3-Pointers", aliases: ["1q 3pt", "first quarter threes", "1q triples"], icon: Timer },
    { label: "Moneyline", aliases: ["ml", "money line", "winner"], icon: Trophy },
    { label: "Spread", aliases: ["ats", "against the spread", "handicap", "line"], icon: Star },
  ],
  mlb: [
    { label: "Hits", aliases: ["h", "base hits"], icon: Target },
    { label: "RBIs", aliases: ["rbi", "runs batted in", "ribbies"], icon: Flame },
    { label: "Strikeouts", aliases: ["k", "ks", "so", "k's", "whiffs"], icon: Crosshair },
    { label: "Home Runs", aliases: ["hr", "hrs", "dingers", "bombs", "homers"], icon: Trophy },
    { label: "Total Bases", aliases: ["tb", "tbs", "bases"], icon: Activity },
    { label: "Walks", aliases: ["bb", "bbs", "base on balls", "free passes"], icon: Hand },
    { label: "Stolen Bases", aliases: ["sb", "sbs", "steals", "swipes"], icon: Zap },
    { label: "Runs", aliases: ["r", "runs scored"], icon: Target },
    { label: "Hits+Runs+RBIs", aliases: ["h+r+rbi", "combo"], icon: Gauge },
    { label: "Pitcher Ks", aliases: ["pitcher strikeouts", "pitcher k", "pk"], icon: Crosshair },
    { label: "Moneyline", aliases: ["ml", "money line", "winner"], icon: Trophy },
    { label: "Run Line", aliases: ["rl", "spread", "handicap"], icon: Star },
  ],
  nhl: [
    { label: "Goals", aliases: ["g", "goals scored", "tallies"], icon: Target },
    { label: "Assists", aliases: ["a", "ast", "apples", "helpers"], icon: Hand },
    { label: "Shots on Goal", aliases: ["sog", "shots", "s"], icon: Crosshair },
    { label: "Points", aliases: ["pts", "pt", "g+a", "goals+assists"], icon: Activity },
    { label: "Saves", aliases: ["sv", "svs", "goalie saves"], icon: Shield },
    { label: "Power Play Points", aliases: ["ppp", "pp pts", "power play"], icon: Zap },
    { label: "Blocked Shots", aliases: ["bs", "blk", "blocks"], icon: Shield },
    { label: "Time on Ice", aliases: ["toi", "ice time", "minutes"], icon: Timer },
    { label: "Moneyline", aliases: ["ml", "money line", "winner"], icon: Trophy },
    { label: "Puck Line", aliases: ["pl", "spread", "handicap"], icon: Star },
  ],
  ufc: [
    { label: "Method of Victory", aliases: ["mov", "method", "ko", "sub", "decision", "tko", "submission"], icon: Swords },
    { label: "Round Props", aliases: ["round", "rnd", "rd", "rounds"], icon: Timer },
    { label: "Fight to Go Distance", aliases: ["distance", "goes the distance", "gtd", "full fight"], icon: CircleDot },
    { label: "Total Rounds", aliases: ["over under rounds", "o/u rounds"], icon: Activity },
    { label: "Moneyline", aliases: ["ml", "money line", "winner", "to win"], icon: Trophy },
  ],
  nfl: [
    { label: "Passing Yards", aliases: ["pass yds", "pass yards", "py", "passing"], icon: Target },
    { label: "Rushing Yards", aliases: ["rush yds", "rush yards", "ry", "rushing"], icon: Zap },
    { label: "Receiving Yards", aliases: ["rec yds", "rec yards", "recy", "receiving"], icon: Hand },
    { label: "Touchdowns", aliases: ["td", "tds", "scores", "anytime td", "attd"], icon: Trophy },
    { label: "Receptions", aliases: ["rec", "recs", "catches"], icon: Hand },
    { label: "Completions", aliases: ["comp", "comps", "pass comp"], icon: Target },
    { label: "Interceptions", aliases: ["int", "ints", "picks"], icon: Crosshair },
    { label: "Moneyline", aliases: ["ml", "money line", "winner"], icon: Trophy },
    { label: "Spread", aliases: ["ats", "against the spread", "handicap", "line"], icon: Star },
  ],
  other: [
    { label: "Moneyline", aliases: ["ml", "money line", "winner"], icon: Trophy },
    { label: "Spread", aliases: ["ats", "handicap", "line"], icon: Star },
    { label: "Total", aliases: ["o/u", "over under", "over/under"], icon: Activity },
    { label: "Prop", aliases: ["player prop", "prop play"], icon: Target },
  ],
};

interface BetTypeDropdownProps {
  sport: string;
  value: string;
  onChange: (value: string) => void;
}

export function BetTypeDropdown({ sport, value, onChange }: BetTypeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const options = SPORT_BET_TYPES[sport] || SPORT_BET_TYPES.other;

  const filterLower = filter.toLowerCase().trim();
  const filtered = filterLower
    ? options.filter(o =>
        o.label.toLowerCase().includes(filterLower) ||
        o.aliases.some(a => a.includes(filterLower) || filterLower.includes(a))
      )
    : options;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Play Type</label>
      <input
        value={open ? filter : value}
        onChange={(e) => { setFilter(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setFilter(""); }}
        placeholder="Select or type..."
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none transition-all duration-300 focus:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]"
        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-xl max-h-[320px] overflow-y-auto pb-2"
          style={{ background: 'hsla(228, 18%, 12%, 0.98)', border: '1px solid hsla(228, 30%, 22%, 0.4)', backdropFilter: 'blur(20px)' }}>
          {filtered.length === 0 ? (
            <button className="w-full px-3 py-2 text-left text-[11px] text-muted-foreground/50 hover:bg-white/5"
              onClick={() => { onChange(filter); setOpen(false); }}>
              Use "{filter}"
            </button>
          ) : filtered.map((opt, i) => {
            const Icon = opt.icon;
            // Show matching alias as hint
            const matchedAlias = filterLower
              ? opt.aliases.find(a => a.includes(filterLower) || filterLower.includes(a))
              : null;
            return (
              <button key={i} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                onClick={() => { onChange(opt.label); setOpen(false); setFilter(""); }}>
                <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'hsla(250, 76%, 62%, 0.12)' }}>
                  <Icon className="w-3 h-3 text-accent" />
                </div>
                <div className="min-w-0">
                  <span className="text-[12px] font-semibold text-foreground">{opt.label}</span>
                  {matchedAlias && matchedAlias !== opt.label.toLowerCase() && (
                    <span className="text-[9px] text-muted-foreground/40 ml-1.5">({matchedAlias})</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
