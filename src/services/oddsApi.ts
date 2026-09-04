import { supabase } from "@/integrations/supabase/client";
import { generateDeviceFingerprint } from "@/utils/fingerprint";
import { getFunctionUrl, getSupabaseAnonKey } from "@/services/supabaseFunctionUrl";
import { premiumRequestHeaders } from "@/lib/premiumRequestHeaders";
import { getMobilePlatform } from "@/lib/mobileDeviceIdentity";

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
  const deviceHeaders = await premiumRequestHeaders();
  return {
    "x-session-token": token,
    "x-device-fingerprint": fingerprint,
    "x-request-nonce": crypto.randomUUID(),
    ...deviceHeaders,
  };
}

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? `Bearer ${session.access_token}`
    : `Bearer ${getSupabaseAnonKey()}`;
}

async function logEdgeError(label: string, resp: Response) {
  console.error("[edge]", label, resp.status);
}

export const LIVE_LINES_UNAVAILABLE_MESSAGE = "Live lines temporarily unavailable — please try again shortly.";

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

export interface UpcomingOddsEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

const SPORT_ALIASES: Record<string, string> = {
  basketball_nba: "nba",
  basketball_wnba: "wnba",
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

function withClientPlatform(params: URLSearchParams): URLSearchParams {
  params.set("client_platform", getMobilePlatform());
  return params;
}

export async function fetchNbaOdds(bookmakers?: string, markets?: string, sport?: string) {
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = new URLSearchParams();
  if (bookmakers) params.set("bookmakers", bookmakers);
  if (markets) params.set("markets", markets);
  if (normalizedSport) params.set("sport", normalizedSport);

  const qs = `?${withClientPlatform(params).toString()}`;
  const resp = await fetch(`${getFunctionUrl("nba-odds")}/events${qs}`, {
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: await getAuthHeader(),
      ...secHeaders,
    },
  });

  if (!resp.ok) {
    await logEdgeError("nba-odds/events", resp);
    throw new Error(LIVE_LINES_UNAVAILABLE_MESSAGE);
  }
  return resp.json();
}

export async function fetchUpcomingOddsEvents(sport?: string): Promise<UpcomingOddsEvent[]> {
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);
  const params = new URLSearchParams();
  if (normalizedSport) params.set("sport", normalizedSport);

  const qs = `?${withClientPlatform(params).toString()}`;
  const resp = await fetch(`${getFunctionUrl("nba-odds")}/event-ids${qs}`, {
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: await getAuthHeader(),
      ...secHeaders,
    },
  });

  if (!resp.ok) {
    await logEdgeError("nba-odds/event-ids", resp);
    throw new Error(LIVE_LINES_UNAVAILABLE_MESSAGE);
  }

  const payload = await resp.json();
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.events) ? payload.events : []);
}

export async function fetchPlayerProps(eventId: string, markets?: string, sport?: string) {
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = new URLSearchParams({ eventId });
  if (markets) params.set("markets", markets);
  if (normalizedSport) params.set("sport", normalizedSport);

  const resp = await fetch(`${getFunctionUrl("nba-odds")}/player-props?${withClientPlatform(params).toString()}`, {
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: await getAuthHeader(),
      ...secHeaders,
    },
  });

  if (!resp.ok) {
    await logEdgeError("nba-odds/player-props", resp);
    throw new Error("Live player odds are temporarily unavailable — please try again shortly.");
  }
  return resp.json();
}

export async function fetchPlayerOdds(playerName: string, propType: string, overUnder: string, sport?: string) {
  const secHeaders = await getSessionHeaders();
  const normalizedSport = normalizeOddsSport(sport);

  const params = withClientPlatform(new URLSearchParams());
  const resp = await fetch(`${getFunctionUrl("nba-odds")}/player-odds?${params.toString()}`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: await getAuthHeader(),
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
    headers: await getSessionHeaders(),
  });
  if (error) {
    console.error("[edge]", "nba-odds/scrape-dfs", error.message || error);
    throw error;
  }
  return data;
}
