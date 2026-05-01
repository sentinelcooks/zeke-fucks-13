import { useState, useEffect, useRef, useCallback } from "react";
import { searchPlayers, searchUfcFighters } from "@/services/api";
import { getTeamLogoUrl } from "@/utils/teamLogos";
import { getSubjectMode, isUfcFighterStat, isUfcFightTotal } from "./marketType";

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

// Cycling fighter name suggestions for UFC fighter fields
const UFC_FIGHTER_PLACEHOLDERS = ["Jon Jones", "Tom Aspinall", "Islam Makhachev", "Conor McGregor"];

const PLAYER_PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "LeBron James",
  mlb: "Shohei Ohtani",
  nhl: "Connor McDavid",
  nfl: "Patrick Mahomes",
};

const TEAM_PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "Los Angeles Lakers",
  mlb: "New York Yankees",
  nhl: "Edmonton Oilers",
  nfl: "Kansas City Chiefs",
};

const MATCHUP_PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "Lakers vs Celtics",
  mlb: "Yankees vs Mets",
  nhl: "Bruins vs Rangers",
  nfl: "Chiefs vs Bills",
  ufc: "Jones vs Aspinall",
};

const LINE_PLACEHOLDER_BY_SPORT: Record<string, string> = {
  nba: "25.5",
  mlb: "1.5",
  nhl: "0.5",
  nfl: "275.5",
};

const UFC_STAT_LINE_PLACEHOLDERS: Record<string, string> = {
  "significant strikes": "45.5",
  "takedowns": "1.5",
  "submission attempts": "0.5",
  "knockdowns": "0.5",
  "control time": "4.5",
};

export function getLinePlaceholder(sport: string, betType?: string): string {
  if (sport === "ufc") {
    if (isUfcFighterStat(betType)) {
      const t = (betType || "").toLowerCase().trim();
      for (const [key, ph] of Object.entries(UFC_STAT_LINE_PLACEHOLDERS)) {
        if (t.includes(key)) return ph;
      }
      return "0.5";
    }
    if (isUfcFightTotal(betType)) return "2.5";
    return "";
  }
  return LINE_PLACEHOLDER_BY_SPORT[sport] || "0.5";
}

// Hardcoded team lists so we don't need an API call
const TEAMS_BY_SPORT: Record<string, string[]> = {
  nba: [
    "Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls",
    "Cleveland Cavaliers", "Dallas Mavericks", "Denver Nuggets", "Detroit Pistons", "Golden State Warriors",
    "Houston Rockets", "Indiana Pacers", "Los Angeles Clippers", "Los Angeles Lakers", "Memphis Grizzlies",
    "Miami Heat", "Milwaukee Bucks", "Minnesota Timberwolves", "New Orleans Pelicans", "New York Knicks",
    "Oklahoma City Thunder", "Orlando Magic", "Philadelphia 76ers", "Phoenix Suns", "Portland Trail Blazers",
    "Sacramento Kings", "San Antonio Spurs", "Toronto Raptors", "Utah Jazz", "Washington Wizards",
  ],
  mlb: [
    "Arizona Diamondbacks", "Atlanta Braves", "Baltimore Orioles", "Boston Red Sox", "Chicago Cubs",
    "Chicago White Sox", "Cincinnati Reds", "Cleveland Guardians", "Colorado Rockies", "Detroit Tigers",
    "Houston Astros", "Kansas City Royals", "Los Angeles Angels", "Los Angeles Dodgers", "Miami Marlins",
    "Milwaukee Brewers", "Minnesota Twins", "New York Mets", "New York Yankees", "Oakland Athletics",
    "Philadelphia Phillies", "Pittsburgh Pirates", "San Diego Padres", "San Francisco Giants", "Seattle Mariners",
    "St. Louis Cardinals", "Tampa Bay Rays", "Texas Rangers", "Toronto Blue Jays", "Washington Nationals",
  ],
  nhl: [
    "Anaheim Ducks", "Boston Bruins", "Buffalo Sabres", "Calgary Flames", "Carolina Hurricanes",
    "Chicago Blackhawks", "Colorado Avalanche", "Columbus Blue Jackets", "Dallas Stars", "Detroit Red Wings",
    "Edmonton Oilers", "Florida Panthers", "Los Angeles Kings", "Minnesota Wild", "Montreal Canadiens",
    "Nashville Predators", "New Jersey Devils", "New York Islanders", "New York Rangers", "Ottawa Senators",
    "Philadelphia Flyers", "Pittsburgh Penguins", "San Jose Sharks", "Seattle Kraken", "St. Louis Blues",
    "Tampa Bay Lightning", "Toronto Maple Leafs", "Utah Hockey Club", "Vancouver Canucks", "Vegas Golden Knights",
    "Washington Capitals", "Winnipeg Jets",
  ],
  nfl: [
    "Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills", "Carolina Panthers",
    "Chicago Bears", "Cincinnati Bengals", "Cleveland Browns", "Dallas Cowboys", "Denver Broncos",
    "Detroit Lions", "Green Bay Packers", "Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars",
    "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers", "Los Angeles Rams", "Miami Dolphins",
    "Minnesota Vikings", "New England Patriots", "New Orleans Saints", "New York Giants", "New York Jets",
    "Philadelphia Eagles", "Pittsburgh Steelers", "San Francisco 49ers", "Seattle Seahawks",
    "Tampa Bay Buccaneers", "Tennessee Titans", "Washington Commanders",
  ],
};

export function PlayerAutocomplete({ sport, value, onChange, betType = "" }: PlayerAutocompleteProps) {
  const subjectMode = getSubjectMode(sport, betType);
  const matchupMode = subjectMode === "matchup" || subjectMode === "fight";
  const isTeamMode = subjectMode === "team";
  const isFighter = subjectMode === "fighter";

  const [suggestions, setSuggestions] = useState<PlayerResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const allTeams: PlayerResult[] = isTeamMode
    ? (TEAMS_BY_SPORT[sport] || []).map(name => ({
        name,
        headshot: getTeamLogoUrl(name, sport as "nba" | "mlb" | "nhl" | "nfl"),
        team: "",
      }))
    : [];

  // Filter teams locally when in team mode
  useEffect(() => {
    if (!isTeamMode) return;
    if (!value || value.length < 1) {
      setSuggestions(allTeams.slice(0, 8));
    } else {
      const q = value.toLowerCase();
      const filtered = allTeams.filter(t => t.name.toLowerCase().includes(q)).slice(0, 8);
      setSuggestions(filtered);
    }
  }, [isTeamMode, value, sport]);

  // Player / fighter search
  const search = useCallback(async (q: string) => {
    if (isTeamMode || matchupMode) return;
    if (q.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    try {
      let results: any;
      if (sport === "ufc" || isFighter) {
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
  }, [sport, isTeamMode, matchupMode, isFighter]);

  useEffect(() => {
    if (isTeamMode || matchupMode) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, search, isTeamMode, matchupMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const label =
    subjectMode === "matchup" ? "Matchup" :
    subjectMode === "fight"   ? "Fight" :
    subjectMode === "team"    ? "Team" :
    subjectMode === "fighter" ? "Fighter" :
    "Player";

  const placeholder =
    subjectMode === "fight"   ? (MATCHUP_PLACEHOLDER_BY_SPORT[sport] || "Fighter A vs Fighter B") :
    subjectMode === "matchup" ? (MATCHUP_PLACEHOLDER_BY_SPORT[sport] || "Team A vs Team B") :
    subjectMode === "team"    ? (TEAM_PLACEHOLDER_BY_SPORT[sport] || "Team name") :
    subjectMode === "fighter" ? UFC_FIGHTER_PLACEHOLDERS[0] :
    (PLAYER_PLACEHOLDER_BY_SPORT[sport] || "Player name");

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (matchupMode) {
            setOpen(false);
            return;
          }
          if (isTeamMode) {
            if (suggestions.length === 0) {
              setSuggestions(allTeams.slice(0, 8));
            }
            setOpen(true);
          } else if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none transition-all duration-300 focus:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]"
        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-[80] top-full left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-xl max-h-[280px] overflow-y-auto pb-1"
          style={{ background: 'hsla(228, 18%, 12%, 0.98)', border: '1px solid hsla(228, 30%, 22%, 0.4)', backdropFilter: 'blur(20px)' }}>
          {loading && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/50">Searching...</div>
          )}
          {suggestions.map((s, i) => (
            <button key={i} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors"
              onClick={() => { onChange(s.name); setOpen(false); }}>
              {s.headshot ? (
                <img src={s.headshot} alt="" className="w-7 h-7 rounded-full object-cover bg-white/5 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0"
                  style={{ background: 'hsla(228, 20%, 18%, 0.8)' }}>
                  {s.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-foreground">{s.name}</p>
                {s.team && <p className="text-[9px] text-muted-foreground/50">{s.team}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
