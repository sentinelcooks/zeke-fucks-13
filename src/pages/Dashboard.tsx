import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { LogOut, Search, Loader2 } from "lucide-react";
import { searchPlayers, getTeams, analyzeProp } from "@/services/api";
import logo from "@/assets/logo.png";
import ResultsPanel from "@/components/ResultsPanel";

const PROP_TYPES = [
  { value: "points", label: "Points" },
  { value: "rebounds", label: "Rebounds" },
  { value: "assists", label: "Assists" },
  { value: "3-pointers", label: "3-Pointers" },
  { value: "steals", label: "Steals" },
  { value: "blocks", label: "Blocks" },
  { value: "turnovers", label: "Turnovers" },
  { value: "pts+reb+ast", label: "PRA (Pts+Reb+Ast)" },
];

const Dashboard = () => {
  const { signOut: logout } = useAuth();
  const navigate = useNavigate();

  const [player, setPlayer] = useState("");
  const [propType, setPropType] = useState("points");
  const [opponent, setOpponent] = useState("");
  const [overUnder, setOverUnder] = useState<"over" | "under">("over");
  const [line, setLine] = useState("");
  const [teams, setTeams] = useState<{ abbr: string; name: string }[]>([]);
  const [suggestions, setSuggestions] = useState<{ name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<any>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTeams().then(setTeams).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const handlePlayerSearch = (q: string) => {
    setPlayer(q);
    clearTimeout(searchTimeout.current);
    if (q.length < 2) {
      setShowSuggestions(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const data = await searchPlayers(q);
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch {
        setShowSuggestions(false);
      }
    }, 250);
  };

  const handleAnalyze = async () => {
    if (!player) { setError("Enter a player name"); return; }
    const lineNum = parseFloat(line);
    if (isNaN(lineNum) || lineNum <= 0) { setError("Enter a valid line value"); return; }

    setLoading(true);
    setError("");
    setResults(null);

    try {
      const data = await analyzeProp({
        player,
        prop_type: propType,
        line: lineNum,
        over_under: overUnder,
        opponent: opponent || undefined,
      });
      if (data.error) {
        setError(data.error);
      } else {
        setResults(data);
      }
    } catch {
      setError("Failed to connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background pt-safe pb-safe">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Primal" className="w-10 h-10 rounded-lg" />
          <div>
            <h1 className="text-lg font-bold text-foreground">NBA Props Checker</h1>
            <p className="text-xs text-muted-foreground">Data-driven player prop analysis</p>
          </div>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="w-4 h-4" /> Logout
        </button>
      </header>

      <div className="max-w-[1100px] mx-auto p-5">
        {/* Search Panel */}
        <div className="bg-card border border-border rounded-2xl p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Player */}
            <div className="flex-1 min-w-[200px] relative" ref={suggestionsRef}>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Player Name</label>
              <input
                type="text"
                value={player}
                onChange={(e) => handlePlayerSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (setShowSuggestions(false), handleAnalyze())}
                placeholder="Search player..."
                className="w-full bg-input border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary transition-all"
              />
              {showSuggestions && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl max-h-[220px] overflow-y-auto z-50">
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      onClick={() => { setPlayer(s.name); setShowSuggestions(false); }}
                      className="px-3.5 py-2.5 text-sm cursor-pointer hover:bg-secondary hover:text-accent transition-colors"
                    >
                      {s.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prop Type */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Prop Type</label>
              <select
                value={propType}
                onChange={(e) => setPropType(e.target.value)}
                className="bg-input border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary transition-all appearance-none pr-8 cursor-pointer"
              >
                {PROP_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Opponent */}
            <div className="min-w-[180px]">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Opponent (optional)</label>
              <select
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                className="w-full bg-input border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary transition-all appearance-none pr-8 cursor-pointer"
              >
                <option value="">Auto-detect (next game)</option>
                {teams.map((t) => (
                  <option key={t.abbr} value={t.abbr}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Over/Under Toggle */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Over / Under</label>
              <div className="flex rounded-xl overflow-hidden border border-border">
                <button
                  onClick={() => setOverUnder("over")}
                  className={`px-5 py-2.5 text-xs font-bold tracking-wider transition-all ${
                    overUnder === "over" ? "bg-nba-green text-accent-foreground" : "bg-input text-muted-foreground"
                  }`}
                >
                  OVER
                </button>
                <button
                  onClick={() => setOverUnder("under")}
                  className={`px-5 py-2.5 text-xs font-bold tracking-wider transition-all ${
                    overUnder === "under" ? "bg-nba-red text-primary-foreground" : "bg-input text-muted-foreground"
                  }`}
                >
                  UNDER
                </button>
              </div>
            </div>

            {/* Line */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Line</label>
              <input
                type="number"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                placeholder="25.5"
                step="0.5"
                min="0"
                className="w-[90px] bg-input border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary transition-all"
              />
            </div>

            {/* Analyze Button */}
            <div>
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="px-8 py-2.5 bg-gradient-to-r from-accent to-[hsl(var(--nba-blue))] text-accent-foreground font-extrabold text-sm tracking-wider rounded-xl hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/30 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                ANALYZE
              </button>
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-16">
            <div className="w-12 h-12 border-4 border-border border-t-accent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">Crunching numbers... Fetching stats from NBA & ESPN...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-nba-red-dim border border-destructive rounded-xl p-4 text-center text-destructive mb-5">
            {error}
          </div>
        )}

        {/* Results */}
        {results && <ResultsPanel data={results} />}
      </div>
    </div>
  );
};

export default Dashboard;
