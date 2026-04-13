import { useState, useRef, useEffect } from "react";
import { Search, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import { searchPlayers, searchUfcFighters } from "@/services/api";

type PropCategory = "popular" | "combos" | "1q" | "shooting";

const NBA_PROP_CATEGORIES: Record<PropCategory, { value: string; label: string }[]> = {
  popular: [
    { value: "points", label: "PTS" },
    { value: "rebounds", label: "REB" },
    { value: "assists", label: "AST" },
    { value: "3-pointers", label: "3PM" },
    { value: "steals", label: "STL" },
    { value: "blocks", label: "BLK" },
    { value: "turnovers", label: "TO" },
  ],
  combos: [
    { value: "pts+reb+ast", label: "PRA" },
    { value: "pts+reb", label: "P+R" },
    { value: "pts+ast", label: "P+A" },
    { value: "reb+ast", label: "R+A" },
  ],
  "1q": [
    { value: "1q_points", label: "1Q PTS" },
    { value: "1q_rebounds", label: "1Q REB" },
    { value: "1q_assists", label: "1Q AST" },
    { value: "1q_3-pointers", label: "1Q 3PM" },
  ],
  shooting: [
    { value: "fg_made", label: "FGM" },
    { value: "fg_attempted", label: "FGA" },
    { value: "ft_made", label: "FTM" },
    { value: "ft_attempted", label: "FTA" },
  ],
};

const CATEGORY_LABELS: { key: PropCategory; label: string }[] = [
  { key: "popular", label: "POPULAR" },
  { key: "combos", label: "COMBOS" },
  { key: "1q", label: "1ST QTR" },
  { key: "shooting", label: "SHOOTING" },
];

const PROP_TYPES_BY_SPORT: Record<string, { value: string; label: string }[]> = {
  MLB: [
    { value: "hits", label: "HITS" },
    { value: "home_runs", label: "HR" },
    { value: "rbis", label: "RBI" },
    { value: "stolen_bases", label: "SB" },
    { value: "strikeouts", label: "K" },
    { value: "total_bases", label: "TB" },
    { value: "runs", label: "R" },
    { value: "walks", label: "BB" },
  ],
  NHL: [
    { value: "goals", label: "G" },
    { value: "assists", label: "AST" },
    { value: "points", label: "PTS" },
    { value: "shots_on_goal", label: "SOG" },
    { value: "saves", label: "SV" },
    { value: "blocked_shots", label: "BS" },
  ],
  NFL: [
    { value: "passing_yards", label: "PASS" },
    { value: "rushing_yards", label: "RUSH" },
    { value: "receiving_yards", label: "REC" },
    { value: "touchdowns", label: "TD" },
    { value: "completions", label: "CMP" },
    { value: "interceptions", label: "INT" },
    { value: "receptions", label: "RCPT" },
  ],
  UFC: [
    { value: "moneyline", label: "ML" },
  ],
};

const PLAYER_PLACEHOLDERS: Record<string, string> = {
  NBA: "LeBron James",
  MLB: "Shohei Ohtani",
  NHL: "Connor McDavid",
  NFL: "Patrick Mahomes",
  UFC: "Islam Makhachev",
};

export interface NbaLegData {
  player: string;
  propType: string;
  line: string;
  overUnder: "over" | "under";
  opponent: string;
}

interface Props {
  data: NbaLegData;
  onChange: (data: NbaLegData) => void;
  sport?: string;
}

export default function NbaLegInput({ data, onChange, sport = "NBA" }: Props) {
  const [suggestions, setSuggestions] = useState<{ name: string }[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PropCategory>("popular");
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const ref = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  const isNba = sport === "NBA";
  const propTypes = isNba
    ? NBA_PROP_CATEGORIES[activeCategory]
    : PROP_TYPES_BY_SPORT[sport] || PROP_TYPES_BY_SPORT.MLB;
  const isUfc = sport === "UFC";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowSug(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const check = () => setShowScrollHint(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [propTypes]);

  const handleSearch = (q: string) => {
    onChange({ ...data, player: q });
    clearTimeout(timeout.current);
    if (q.length < 2) { setShowSug(false); return; }
    timeout.current = setTimeout(async () => {
      try {
        let res: any[];
        if (sport === "UFC") {
          res = await searchUfcFighters(q);
        } else {
          res = await searchPlayers(q, sport.toLowerCase());
        }
        setSuggestions(res);
        setShowSug(res.length > 0);
      } catch { setShowSug(false); }
    }, 250);
  };

  return (
    <div className="space-y-2.5">
      {/* Player search */}
      <div className="relative" ref={ref}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
          <input
            type="text" value={data.player}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={PLAYER_PLACEHOLDERS[sport] || "Player name..."}
            className="w-full bg-secondary/30 border border-border/30 rounded-xl pl-9 pr-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-1 focus:ring-primary/25 focus:border-primary/25 transition-all"
          />
        </div>
        {showSug && (
          <div className="absolute top-full left-0 right-0 mt-1 border border-border/30 rounded-xl max-h-[180px] overflow-y-auto z-50 shadow-xl bg-card backdrop-blur-xl">
            {suggestions.map((s, i) => (
              <div key={i} onClick={() => { onChange({ ...data, player: s.name }); setShowSug(false); }}
                className="px-3 py-2.5 text-xs cursor-pointer hover:bg-primary/8 transition-colors first:rounded-t-xl last:rounded-b-xl text-foreground/80">
                {s.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* NBA category tabs */}
      {isNba && !isUfc && (
        <div className="flex gap-0.5">
          {CATEGORY_LABELS.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-semibold tracking-wide transition-all ${
                activeCategory === cat.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/40 hover:text-muted-foreground/60"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Prop type chips */}
      {!isUfc && (
        <div className="relative">
          <div ref={chipsRef} className="flex gap-1 overflow-x-auto scrollbar-none pb-0.5">
            {propTypes.map((p) => (
              <button key={p.value} onClick={() => onChange({ ...data, propType: p.value })}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all border whitespace-nowrap shrink-0 ${
                  data.propType === p.value
                    ? "bg-primary/12 border-primary/25 text-primary"
                    : "bg-secondary/20 border-border/20 text-muted-foreground/50 hover:text-muted-foreground/70"
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {showScrollHint && (
            <div className="absolute right-0 top-0 bottom-0.5 flex items-center pointer-events-none">
              <div className="bg-gradient-to-l from-background via-background/80 to-transparent pl-4 pr-1">
                <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Line + O/U */}
      {!isUfc && (
        <div className="flex gap-2 items-center">
          <div className="flex gap-0.5 p-0.5 rounded-lg border border-border/25 shrink-0 bg-secondary/20">
            <button onClick={() => onChange({ ...data, overUnder: "over" })}
              className={`flex items-center justify-center gap-0.5 px-3 py-2 rounded-md text-[10px] font-semibold transition-all ${
                data.overUnder === "over"
                  ? "bg-nba-green/15 text-nba-green"
                  : "text-muted-foreground/40"
              }`}
            ><TrendingUp className="w-3 h-3" />O</button>
            <button onClick={() => onChange({ ...data, overUnder: "under" })}
              className={`flex items-center justify-center gap-0.5 px-3 py-2 rounded-md text-[10px] font-semibold transition-all ${
                data.overUnder === "under"
                  ? "bg-destructive/15 text-destructive"
                  : "text-muted-foreground/40"
              }`}
            ><TrendingDown className="w-3 h-3" />U</button>
          </div>
          <input type="number" value={data.line} onChange={(e) => onChange({ ...data, line: e.target.value })}
            placeholder={sport === "NHL" ? "0.5" : sport === "NFL" ? "275.5" : sport === "MLB" ? "1.5" : "25.5"}
            step="0.5" min="0"
            className="flex-1 bg-secondary/30 border border-border/30 rounded-xl px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:ring-1 focus:ring-primary/25 transition-all" />
        </div>
      )}
    </div>
  );
}
