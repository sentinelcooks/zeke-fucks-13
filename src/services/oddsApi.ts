import { supabase } from "@/integrations/supabase/client";
import { generateDeviceFingerprint } from "@/utils/fingerprint";

function getProjectId(): string {
  const explicit = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (explicit) return explicit;
  const url = import.meta.env.VITE_SUPABASE_URL || "";
  try { return new URL(url).hostname.split(".")[0]; } catch { return ""; }
}

function getStoredSessionToken(): string {
  const remember = localStorage.getItem("primal-remember") === "true";
  const preferredStore = remember ? localStorage : sessionStorage;

  return (
    preferredStore.getItem("primal-session-token") ||
    localStorage.getItem("primal-session-token") ||
    sessionStorage.getItem("primal-session-token") ||
    ""
  );
}

async function getSessionHeaders(): Promise<Record<string, string>> {
  const token = getStoredSessionToken();
  const fingerprint = await generateDeviceFingerprint();
  return {
    "x-session-token": token,
    "x-device-fingerprint": fingerprint,
    "x-request-nonce": crypto.randomUUID(),
  };
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
        description?: string;
      }>;
    }>;
  }>;
}

const SPORT_ALIASES: Record<string, string> = {
  basketball_nba: "nba",
  baseball_mlb: "mlb",
  mma_mixed_martial_arts: "ufc",
  icehockey_nhl: "nhl",
  americanfootball_nfl: "nfl",
  soccer_usa_mls: "soccer",
};

function normalizeOddsSport(sport?: string) {
  if (!sport) return sport;
  return SPORT_ALIASES[sport.toLowerCase()] ?? sport;
}

export async function fetchNbaOdds(bookmakers?: string, markets?: string, sport?: string) {
  const projectId = getProjectId();
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = new URLSearchParams();
  if (bookmakers) params.set("bookmakers", bookmakers);
  if (markets) params.set("markets", markets);
  if (normalizedSport) params.set("sport", normalizedSport);

  const qs = params.toString() ? `?${params.toString()}` : "";
  const resp = await fetch(
    `https://${projectId}.supabase.co/functions/v1/nba-odds/events${qs}`,
    {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        ...secHeaders,
      },
    }
  );

  if (!resp.ok) throw new Error(`Odds API error ${resp.status}`);
  return resp.json();
}

export async function fetchPlayerProps(eventId: string, markets?: string, sport?: string) {
  const projectId = getProjectId();
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = new URLSearchParams({ eventId });
  if (markets) params.set("markets", markets);
  if (normalizedSport) params.set("sport", normalizedSport);

  const resp = await fetch(
    `https://${projectId}.supabase.co/functions/v1/nba-odds/player-props?${params.toString()}`,
    {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        ...secHeaders,
      },
    }
  );

  if (!resp.ok) throw new Error(`Player props error ${resp.status}`);
  return resp.json();
}

export async function fetchPlayerOdds(playerName: string, propType: string, overUnder: string, sport?: string) {
  const projectId = getProjectId();
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const resp = await fetch(
    `https://${projectId}.supabase.co/functions/v1/nba-odds/player-odds`,
    {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        ...secHeaders,
      },
      body: JSON.stringify({ playerName, propType, overUnder, sport: normalizedSport }),
    }
  );

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: `Player odds error ${resp.status}` }));
    return { found: false, books: [], error: body.error || `Error ${resp.status}` };
  }
  return resp.json();
}

export async function scrapeDfsOdds(playerName: string, book: string) {
  const { data, error } = await supabase.functions.invoke("nba-odds/scrape-dfs", {
    body: { playerName, book },
  });
  if (error) throw error;
  return data;
}
