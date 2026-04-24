/**
 * Secure API layer — all requests include session token + fingerprint signature.
 * Edge functions validate the session on every call.
 */

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
  const timestamp = Date.now().toString();

  return {
    "x-session-token": token,
    "x-device-fingerprint": fingerprint,
    "x-request-timestamp": timestamp,
    "x-request-nonce": crypto.randomUUID(),
  };
}

async function callEdgeFunction(
  functionName: string,
  action: string,
  params?: Record<string, any>,
  method: "GET" | "POST" = "GET"
) {
  const secHeaders = await getSessionHeaders();
  const projectId = getProjectId();
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/${functionName}`;

  if (method === "POST") {
    const { data, error } = await supabase.functions.invoke(`${functionName}/${action}`, {
      body: { ...params, __sec: secHeaders },
    });
    if (error) throw error;
    return data;
  }

  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const url = `${baseUrl}/${action}${qs}`;
  const resp = await fetch(url, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      ...secHeaders,
    },
  });
  if (!resp.ok) throw new Error(`API error ${resp.status}`);
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

export async function analyzeProp(data: AnalyzeRequest) {
  return callEdgeFunction("nba-api", "analyze", data as any, "POST");
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
