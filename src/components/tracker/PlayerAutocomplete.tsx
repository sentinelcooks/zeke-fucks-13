import { useState, useEffect, useRef, useCallback } from "react";
import { searchPlayers, searchUfcFighters } from "@/services/api";

interface PlayerAutocompleteProps {
  sport: string;
  value: string;
  onChange: (value: string) => void;
}

interface PlayerResult {
  name: string;
  headshot?: string;
  team?: string;
}

const PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "LeBron James",
  mlb: "Shohei Ohtani",
  nhl: "Connor McDavid",
  ufc: "Conor McGregor",
  nfl: "Patrick Mahomes",
};

const LINE_PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "25.5",
  mlb: "1.5",
  nhl: "0.5",
  ufc: "",
  nfl: "275.5",
};

export function getLinePlaceholder(sport: string): string {
  return LINE_PLACEHOLDER_BY_SPORT[sport] || "0.5";
}

export function PlayerAutocomplete({ sport, value, onChange }: PlayerAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PlayerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    try {
      let results: any;
      if (sport === "ufc") {
        results = await searchUfcFighters(q);
      } else {
        results = await searchPlayers(q, sport);
      }
      const list: PlayerResult[] = (Array.isArray(results) ? results : results?.players || [])
        .slice(0, 6)
        .map((p: any) => ({
          name: p.name || p.full_name || p.strFighter || p.player_name || "",
          headshot: p.headshot || p.strThumb || "",
          team: p.team || p.strTeam || "",
        }));
      setSuggestions(list);
      setOpen(list.length > 0);
    } catch { setSuggestions([]); }
    setLoading(false);
  }, [sport]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">Player</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={PLACEHOLDER_BY_SPORT[sport] || "Player name"}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none transition-all duration-300 focus:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]"
        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-xl"
          style={{ background: 'hsla(228, 18%, 12%, 0.98)', border: '1px solid hsla(228, 30%, 22%, 0.4)', backdropFilter: 'blur(20px)' }}>
          {loading && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/50">Searching...</div>
          )}
          {suggestions.map((s, i) => (
            <button key={i} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors"
              onClick={() => { onChange(s.name); setOpen(false); }}>
              {s.headshot ? (
                <img src={s.headshot} alt="" className="w-7 h-7 rounded-full object-cover bg-white/5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-muted-foreground"
                  style={{ background: 'hsla(228, 20%, 18%, 0.8)' }}>
                  {s.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-foreground truncate">{s.name}</p>
                {s.team && <p className="text-[9px] text-muted-foreground/50">{s.team}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
