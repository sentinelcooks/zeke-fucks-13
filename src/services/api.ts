/**
 * Secure API layer — all requests include session token + fingerprint signature.
 * Edge functions validate the session on every call.
 */

import { supabase } from "@/integrations/supabase/client";
import { generateDeviceFingerprint } from "@/utils/fingerprint";
import { getFunctionUrl, getSupabaseAnonKey } from "@/services/supabaseFunctionUrl";
import { premiumRequestHeaders } from "@/lib/premiumRequestHeaders";
import { withClientPlatform } from "@/lib/edgeFunctionPath";
import { validateMlbPropLine } from "../../supabase/functions/_shared/prop_normalization";

export { validateMlbPropLine };

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
  const timestamp = Date.now().toString();
  const deviceHeaders = await premiumRequestHeaders();

  return {
    "x-session-token": token,
    "x-device-fingerprint": fingerprint,
    "x-request-timestamp": timestamp,
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

async function callEdgeFunction(
  functionName: string,
  action: string,
  params?: Record<string, unknown>,
  method: "GET" | "POST" = "GET"
) {
  const secHeaders = await getSessionHeaders();
  // The per-sport model endpoints are the function root, with no sub-path, so
  // an empty action must not leave a trailing slash on the URL.
  const path = action ? `${functionName}/${action}` : functionName;

  if (method === "POST") {
    const { data, error } = await supabase.functions.invoke(withClientPlatform(path), {
      body: { ...params, __sec: secHeaders },
      headers: secHeaders,
    });
    if (error) {
      console.error("[edge]", functionName, action, error.message || error);
      throw error;
    }
    return data;
  }

  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const url = withClientPlatform(
    action ? `${getFunctionUrl(functionName)}/${action}${qs}` : `${getFunctionUrl(functionName)}${qs}`,
  );
  const resp = await fetch(url, {
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: await getAuthHeader(),
      ...secHeaders,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("[edge]", functionName, action, resp.status, body.slice(0, 500));
    throw new Error(`API error ${resp.status}`);
  }
  return resp.json();
}

// NBA / MLB
export async function searchPlayers(query: string, sport: string = "nba") {
  return callEdgeFunction("nba-api", "search", { q: query, sport });
}

export async function getTeams(sport: string = "nba") {
  return callEdgeFunction("nba-api", "teams", { sport });
}

export interface AnalyzeRequest {
  player: string;
  prop_type: string;
  line: number;
  over_under: "over" | "under";
  opponent?: string;
  sport?: string;
}

/**
 * Player-prop analyzers that have their own Edge Function.
 *
 * MLB and WNBA were split out of `nba-api`, which still serves NBA and NHL.
 * These endpoints take the same request body and return the same response
 * contract, so the props screen needs no branch of its own.
 *
 * Keep in sync with `analyzerEndpointForCandidate` in
 * `supabase/functions/_shared/analyzer_routing.ts`, which routes the scanner
 * and queue at the same functions.
 */
const PROP_ANALYZER_BY_SPORT: Record<string, string> = {
  mlb: "mlb-prop-model",
  wnba: "wnba-prop-model",
};

// Multi-sport manual analyzer. NBA and NHL dispatch through nba-api/analyze's
// sport-aware ESPN configs; MLB and WNBA have dedicated functions. Saved-pick
// callers branch upstream and never reach this function.
export async function analyzeProp(data: AnalyzeRequest) {
  const sport = data.sport?.toLowerCase() ?? "";

  if (sport === "mlb") {
    const lineValidation = validateMlbPropLine(data.prop_type, data.line);
    if (!lineValidation.valid) {
      return {
        error: lineValidation.error,
        code: lineValidation.code,
        sport: "mlb",
        prop_type: lineValidation.propType,
        line: data.line,
      };
    }
  }

  const dedicated = PROP_ANALYZER_BY_SPORT[sport];
  if (dedicated) {
    return await callEdgeFunction(dedicated, "", data as Record<string, unknown>, "POST");
  }
  return await callEdgeFunction("nba-api", "analyze", data as Record<string, unknown>, "POST");
}

// UFC
export async function searchUfcFighters(query: string) {
  return callEdgeFunction("ufc-api", "search", { q: query });
}

export async function analyzeUfcFighter(fighter: string) {
  return callEdgeFunction("ufc-api", "analyze", { fighter }, "POST");
}

export async function analyzeUfcMatchup(fighter1: string, fighter2: string) {
  return callEdgeFunction("ufc-api", "matchup", { fighter1, fighter2 }, "POST");
}

// NFL — two independent products with separate endpoints. The game engine
// (ML / spread / total) and the player-prop engine never share a call.
export async function fetchNflGameEdge(
  params: { action: "list"; days?: number } | { game_id: string } | { home_team: string; away_team: string; commence_time?: string },
) {
  return callEdgeFunction("nfl-game-edge", "", params as Record<string, unknown>, "POST");
}

export async function fetchNflPlayerPropEdge(
  params:
    | { action: "list"; days?: number }
    | { player: string; prop_type: string; line: number; over_under?: "over" | "under"; opponent?: string },
) {
  return callEdgeFunction("nfl-player-prop-edge", "", params as Record<string, unknown>, "POST");
}

/** NFL player search for the analyzer — backed by the NFL feature store, not ESPN. */
export async function searchNflPlayers(q: string): Promise<Array<{ name: string; team: string; position: string; headshot: string | null }>> {
  const data = await callEdgeFunction("nfl-player-prop-edge", "", { action: "search", q }, "POST");
  return Array.isArray(data) ? data : [];
}
