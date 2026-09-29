import { useEffect, useRef, useState, type RefObject } from "react";
import { CalendarDays, ChevronDown, ChevronUp, Info, Loader2, Minus, Plus, Search, Sparkles, X } from "lucide-react";
import { UnderlineTabs } from "@/components/analyze/SportChips";
import { PlayerAvatar, TrendingTonight } from "@/components/analyze/TrendingTonight";
import { formatGameTime } from "@/lib/playerDisplay";
import type { TrendingPropItem } from "@/hooks/useTrendingProps";

export interface PanelPropOption {
  value: string;
  label: string;
  desc?: string;
}

export interface PanelPropCategory {
  category: string;
  props: PanelPropOption[];
}

export interface PlayerSuggestion {
  id?: string;
  name: string;
  headshot?: string;
  position?: string;
  jersey?: string;
  team?: string;
  teamName?: string;
}

/** The player the user committed to (from search or Trending tonight). */
export interface PickedPlayer {
  name: string;
  team?: string | null;
  /** "Aces @ Mercury" style label, when known. */
  matchup?: string | null;
  commenceTime?: string | null;
  headshot?: string | null;
}

interface PlayerPropsPanelProps {
  sportLabel: string;
  // Player
  player: string;
  picked: PickedPlayer | null;
  onPlayerSearch: (query: string) => void;
  onClearPlayer: () => void;
  suggestions: PlayerSuggestion[];
  showSuggestions: boolean;
  onPickSuggestion: (suggestion: PlayerSuggestion) => void;
  suggestionsRef: RefObject<HTMLDivElement>;
  onSearchSubmit: () => void;
  // Trending
  trending: TrendingPropItem[];
  onPickTrending: (item: TrendingPropItem) => void;
  // Stat
  categories: PanelPropCategory[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  propType: string;
  onPropSelect: (value: string) => void;
  onExplainProp: (prop: { value: string; label: string }) => void;
  // Line
  line: string;
  onLineChange: (value: string) => void;
  bookLine: number | null;
  bookLineLoading: boolean;
  overUnder: "over" | "under";
  onOverUnderChange: (value: "over" | "under") => void;
  // Opponent
  teams: { abbr: string; name: string }[];
  opponent: string;
  onOpponentChange: (abbr: string) => void;
  // Submit
  loading: boolean;
  onAnalyze: () => void;
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts[parts.length - 1] ?? name;
}

function formatLine(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

const cardClass = "rounded-[22px] bg-card shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]";
const labelClass = "text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

function OpponentPicker({ teams, opponent, onChange }: { teams: { abbr: string; name: string }[]; opponent: string; onChange: (abbr: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? teams.filter((t) => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q))
    : teams;
  const current = teams.find((t) => t.abbr === opponent)?.name ?? "Auto-detect next game";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-[13px] text-muted-foreground"
      >
        <span>
          vs <span className="font-semibold text-foreground">{current}</span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-2xl bg-card shadow-[inset_0_0_0_0.5px_hsl(var(--hairline)),0_12px_32px_-8px_hsl(var(--background)_/_0.6)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search team…"
            className="w-full border-b border-hairline bg-transparent px-4 py-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { onChange(""); setQuery(""); setOpen(false); }}
            className={`w-full px-4 py-2.5 text-left text-[13px] ${!opponent ? "font-semibold text-primary" : "text-foreground"}`}
          >
            Auto-detect next game
          </button>
          {filtered.map((team) => (
            <button
              key={team.abbr}
              type="button"
              onClick={() => { onChange(team.abbr); setQuery(""); setOpen(false); }}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] ${
                opponent === team.abbr ? "font-semibold text-primary" : "text-foreground"
              }`}
            >
              <span>{team.name}</span>
              <span className="text-[11px] text-muted-foreground">{team.abbr}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-4 py-3 text-center text-[12px] text-muted-foreground">No teams found</p>}
        </div>
      )}
    </div>
  );
}

export function PlayerPropsPanel(props: PlayerPropsPanelProps) {
  const {
    sportLabel, player, picked, onPlayerSearch, onClearPlayer, suggestions, showSuggestions,
    onPickSuggestion, suggestionsRef, onSearchSubmit, trending, onPickTrending, categories,
    activeCategory, onCategoryChange, propType, onPropSelect, onExplainProp, line, onLineChange,
    bookLine, bookLineLoading, overUnder, onOverUnderChange, teams, opponent, onOpponentChange,
    loading, onAnalyze,
  } = props;

  const allProps = categories.flatMap((c) => c.props);
  const statLabel = (value: string) => allProps.find((p) => p.value === value)?.label ?? value.toUpperCase();
  const selectedProp = allProps.find((p) => p.value === propType);
  const activeProps = categories.find((c) => c.category === activeCategory)?.props ?? [];

  const numericLine = Number.parseFloat(line);
  const hasLine = Number.isFinite(numericLine) && numericLine >= 0;
  const onBookLine = hasLine && bookLine !== null && numericLine === bookLine;
  const step = (delta: number) => {
    const base = hasLine ? numericLine : bookLine ?? 0;
    onLineChange(String(Math.max(0, Math.round((base + delta) * 2) / 2)));
  };

  const gameMeta = picked
    ? [picked.team ?? picked.matchup, formatGameTime(picked.commenceTime)].filter(Boolean).join(" · ")
    : "";
  const ctaLabel = picked && hasLine
    ? `Analyze ${lastName(picked.name)} ${overUnder === "over" ? "O" : "U"} ${formatLine(numericLine)} ${statLabel(propType)}`
    : picked
      ? "Set a line to analyze"
      : "Pick a player to analyze";

  return (
    <div className="space-y-3">
      {/* ── Player: search, or the picked player's card ── */}
      {picked ? (
        <div className={`${cardClass} flex items-center gap-3 p-3.5`}>
          <PlayerAvatar name={picked.name} size={48} ring src={picked.headshot} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-bold text-foreground">{picked.name}</p>
            {gameMeta && (
              <p className="flex items-center gap-1 truncate text-[12px] text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {gameMeta}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClearPlayer}
            className="h-10 shrink-0 rounded-xl border border-hairline bg-secondary/60 px-4 text-[14px] font-semibold text-foreground active:scale-95"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div ref={suggestionsRef} className="relative z-30">
            <div className={`${cardClass} flex h-[52px] items-center gap-2.5 px-4`}>
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="text"
                value={player}
                onChange={(e) => onPlayerSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearchSubmit()}
                placeholder={`Search any ${sportLabel} player`}
                aria-label={`Search ${sportLabel} players`}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {player ? (
                <button type="button" onClick={onClearPlayer} aria-label="Clear search" className="grid h-7 w-7 place-items-center rounded-full bg-fill/15 text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                  Live
                </span>
              )}
            </div>

            {showSuggestions && (
              <ul className="absolute left-0 right-0 z-50 mt-2 max-h-[340px] overflow-y-auto rounded-2xl bg-card shadow-[inset_0_0_0_0.5px_hsl(var(--hairline)),0_12px_32px_-8px_hsl(var(--background)_/_0.6)]">
                {suggestions.map((s, i) => (
                  <li key={s.id ?? `${s.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => onPickSuggestion(s)}
                      className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-left last:border-0 active:bg-fill/10"
                    >
                      {s.headshot ? (
                        <img src={s.headshot} alt="" className="h-10 w-10 shrink-0 rounded-full bg-fill/15 object-cover object-top" />
                      ) : (
                        <PlayerAvatar name={s.name} size={40} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-foreground">{s.name}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {[s.team, s.position, s.jersey ? `#${s.jersey}` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <TrendingTonight items={trending} statLabel={statLabel} onPick={onPickTrending} />
        </>
      )}

      {/* ── Stat ── */}
      <div className={`${cardClass} p-4`}>
        <p className={labelClass}>Stat</p>
        {categories.length > 1 && (
          <div className="mt-2">
            <UnderlineTabs
              ariaLabel="Stat category"
              options={categories.map((c) => ({ value: c.category, label: c.category }))}
              value={activeCategory}
              onChange={onCategoryChange}
            />
          </div>
        )}
        <div className="mt-3 grid grid-cols-4 gap-2">
          {activeProps.map((p) => {
            const active = p.value === propType;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => onPropSelect(p.value)}
                aria-pressed={active}
                className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl border px-1 py-2 text-center transition-colors active:scale-[0.97] ${
                  active
                    ? "border-primary bg-primary/15"
                    : "border-hairline bg-secondary/40"
                }`}
              >
                <span className={`text-[15px] font-bold leading-tight ${active ? "text-foreground" : "text-foreground/85"}`}>{p.label}</span>
                {p.desc && <span className="mt-0.5 line-clamp-1 text-[11px] leading-tight text-muted-foreground">{p.desc}</span>}
              </button>
            );
          })}
        </div>
        {selectedProp && (
          <button
            type="button"
            onClick={() => onExplainProp({ value: selectedProp.value, label: selectedProp.label })}
            className="mt-3 flex min-h-[32px] items-center gap-1.5 text-[12px] text-muted-foreground"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            What does {selectedProp.label} mean?
          </button>
        )}
      </div>

      {/* ── Line ── */}
      <div className={`${cardClass} p-4`}>
        <div className="flex items-center justify-between gap-3">
          <p className={labelClass}>Line</p>
          {picked && (bookLine !== null || bookLineLoading) && (
            <button
              type="button"
              disabled={bookLine === null}
              onClick={() => bookLine !== null && onLineChange(String(bookLine))}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-primary/60 bg-primary/10 px-2.5 text-[12px] text-muted-foreground"
              aria-label={bookLine !== null ? `Use book line ${bookLine}` : "Loading book line"}
            >
              Book
              {bookLine !== null
                ? <span className="font-mono font-bold tabular-nums text-foreground">{bookLine}</span>
                : <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            </button>
          )}
        </div>

        {picked ? (
          <>
            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => step(-0.5)}
                aria-label="Lower line by half a point"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-hairline bg-secondary/40 text-foreground active:scale-95"
              >
                <Minus className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <input
                  type="text"
                  inputMode="decimal"
                  value={line}
                  onChange={(e) => onLineChange(e.target.value.replace(/[^\d.]/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && onAnalyze()}
                  placeholder="0.0"
                  aria-label="Line"
                  className="w-full bg-transparent text-center font-mono text-[40px] font-bold leading-none tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {statLabel(propType)} · {onBookLine ? "book line" : bookLine !== null ? `book ${bookLine}` : "your line"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => step(0.5)}
                aria-label="Raise line by half a point"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-hairline bg-secondary/40 text-foreground active:scale-95"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["over", "under"] as const).map((side) => {
                const active = overUnder === side;
                const Icon = side === "over" ? ChevronUp : ChevronDown;
                const tone = side === "over"
                  ? "border-success/70 bg-success/15 text-success"
                  : "border-destructive/70 bg-destructive/15 text-destructive";
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => onOverUnderChange(side)}
                    aria-pressed={active}
                    className={`flex h-12 items-center justify-center gap-1.5 rounded-xl border text-[15px] font-bold uppercase tracking-[0.08em] transition-colors active:scale-[0.98] ${
                      active ? tone : "border-hairline bg-secondary/30 text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {side}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 border-t border-hairline pt-1">
              <OpponentPicker teams={teams} opponent={opponent} onChange={onOpponentChange} />
            </div>
          </>
        ) : (
          <div className="mt-3 grid h-14 place-items-center rounded-xl border border-hairline bg-secondary/30 text-[15px] text-muted-foreground">
            Pick a player to analyze
          </div>
        )}
      </div>

      {/* ── Analyze ── */}
      <div className="sticky bottom-24 z-30 pt-1">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading || !picked || !hasLine}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-[17px] font-bold text-primary-foreground transition-opacity active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          <span className="truncate">{loading ? "Analyzing…" : ctaLabel}</span>
        </button>
      </div>
    </div>
  );
}
