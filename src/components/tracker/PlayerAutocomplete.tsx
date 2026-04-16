import { useState, useEffect, useRef, useCallback } from "react";
import { searchPlayers, searchUfcFighters, getTeams } from "@/services/api";

interface PlayerAutocompleteProps {
  sport: string;
  value: string;
  onChange: (value: string) => void;
  betType?: string;
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

const TEAM_PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "Los Angeles Lakers",
  mlb: "New York Yankees",
  nhl: "Edmonton Oilers",
  nfl: "Kansas City Chiefs",
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

const MONEYLINE_TYPES = ["moneyline", "ml", "money line", "spread", "run line", "puck line"];

export function PlayerAutocomplete({ sport, value, onChange, betType = "" }: PlayerAutocompleteProps) {
  const isTeamMode = MONEYLINE_TYPES.some(t => betType.toLowerCase().includes(t));
  const [suggestions, setSuggestions] = useState<PlayerResult[]>([]);
  const [allTeams, setAllTeams] = useState<PlayerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch teams once when entering team mode
  useEffect(() => {
    if (isTeamMode && allTeams.length === 0 && ["nba", "mlb", "nhl", "nfl"].includes(sport)) {
      setLoading(true);
      getTeams(sport).then((res: any) => {
        const teams: PlayerResult[] = (Array.isArray(res) ? res : res?.teams || [])
          .map((t: any) => ({
            name: t.displayName || t.name || t.strTeam || "",
            headshot: t.logo || t.logos?.[0]?.href || "",
            team: t.abbreviation || t.short || "",
          }))
          .filter((t: PlayerResult) => t.name);
        setAllTeams(teams);
      }).catch(() => {}).finally(() => setLoading(false));
    }
  }, [isTeamMode, sport]);

  // Filter teams locally
  useEffect(() => {
    if (isTeamMode) {
      if (!value || value.length < 1) {
        setSuggestions(allTeams.slice(0, 8));
        if (allTeams.length > 0) setOpen(true);
      } else {
        const q = value.toLowerCase();
        const filtered = allTeams.filter(t =>
          t.name.toLowerCase().includes(q) || (t.team || "").toLowerCase().includes(q)
        ).slice(0, 8);
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
      }
      return;
    }
  }, [isTeamMode, value, allTeams]);

  // Player search (non-team mode)
  const search = useCallback(async (q: string) => {
    if (isTeamMode) return;
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
  }, [sport, isTeamMode]);

  useEffect(() => {
    if (isTeamMode) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, search, isTeamMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const label = isTeamMode ? "Team" : "Player";
  const placeholder = isTeamMode
    ? (TEAM_PLACEHOLDER_BY_SPORT[sport] || "Team name")
    : (PLACEHOLDER_BY_SPORT[sport] || "Player name");

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (isTeamMode && suggestions.length === 0 && allTeams.length > 0) {
            setSuggestions(allTeams.slice(0, 8));
            setOpen(true);
          } else if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none transition-all duration-300 focus:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]"
        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
      />
      {open && (
        <div className="absolute z-[80] top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-xl max-h-[280px] overflow-y-auto"
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
