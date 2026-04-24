import { supabase } from "@/integrations/supabase/client";
import { generateDeviceFingerprint } from "@/utils/fingerprint";
import { getFunctionUrl, getSupabaseAnonKey } from "@/services/supabaseFunctionUrl";

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

async function logEdgeError(label: string, resp: Response) {
  const body = await resp.text().catch(() => "");
  console.error("[edge]", label, resp.status, body.slice(0, 500));
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
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = new URLSearchParams();
  if (bookmakers) params.set("bookmakers", bookmakers);
  if (markets) params.set("markets", markets);
  if (normalizedSport) params.set("sport", normalizedSport);

  const qs = params.toString() ? `?${params.toString()}` : "";
  const resp = await fetch(`${getFunctionUrl("nba-odds")}/events${qs}`, {
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${getSupabaseAnonKey()}`,
      ...secHeaders,
    },
  });

  if (!resp.ok) {
    await logEdgeError("nba-odds/events", resp);
    throw new Error(`Odds API error ${resp.status}`);
  }
  return resp.json();
}

export async function fetchPlayerProps(eventId: string, markets?: string, sport?: string) {
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = new URLSearchParams({ eventId });
  if (markets) params.set("markets", markets);
  if (normalizedSport) params.set("sport", normalizedSport);

  const resp = await fetch(`${getFunctionUrl("nba-odds")}/player-props?${params.toString()}`, {
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${getSupabaseAnonKey()}`,
      ...secHeaders,
    },
  });

  if (!resp.ok) {
    await logEdgeError("nba-odds/player-props", resp);
    throw new Error(`Player props error ${resp.status}`);
  }
  return resp.json();
}

export async function fetchPlayerOdds(playerName: string, propType: string, overUnder: string, sport?: string) {
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const resp = await fetch(`${getFunctionUrl("nba-odds")}/player-odds`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${getSupabaseAnonKey()}`,
      "Content-Type": "application/json",
      ...secHeaders,
    },
    body: JSON.stringify({ playerName, propType, overUnder, sport: normalizedSport }),
  });

  if (!resp.ok) {
    await logEdgeError("nba-odds/player-odds", resp);
    const body = await resp.json().catch(() => ({ error: `Player odds error ${resp.status}` }));
    return { found: false, books: [], error: body.error || `Error ${resp.status}` };
  }
  return resp.json();
}

export async function scrapeDfsOdds(playerName: string, book: string) {
  const { data, error } = await supabase.functions.invoke("nba-odds/scrape-dfs", {
    body: { playerName, book },
  });
  if (error) {
    console.error("[edge]", "nba-odds/scrape-dfs", error.message || error);
    throw error;
  }
  return data;
}
