// Phone device management — list / revoke for the authenticated user.
// All actions are scoped to the caller's user_id; no cross-user access.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isUuidLike(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16 && v.length <= 128;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const HASH_SECRET = Deno.env.get("DEVICE_ID_HASH_SECRET");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !HASH_SECRET) {
    return json({ ok: false, error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!jwt) return json({ ok: false, error: "Missing authorization" }, 401);

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ ok: false, error: "Invalid session" }, 401);
  const user = userData.user;

  let body: { action?: unknown; deviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "list_devices") {
    const { data, error } = await admin
      .from("user_devices")
      .select("id, platform, device_label, first_seen, last_seen, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("last_seen", { ascending: false });
    if (error) return json({ ok: false, error: "List failed" }, 500);
    return json({ ok: true, devices: data ?? [] });
  }

  if (action === "revoke_device") {
    if (!isUuidLike(body.deviceId)) return json({ ok: false, error: "Invalid deviceId" }, 400);
    const targetId = body.deviceId as string;
    const { data, error } = await admin
      .from("user_devices")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", targetId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("id");
    if (error) return json({ ok: false, error: "Revoke failed" }, 500);
    return json({ ok: true, revoked: data?.length ?? 0 });
  }

  if (action === "revoke_all_except_current") {
    if (!isUuidLike(body.deviceId)) return json({ ok: false, error: "Invalid deviceId" }, 400);
    const currentHash = await sha256((body.deviceId as string) + HASH_SECRET);
    const { data, error } = await admin
      .from("user_devices")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("status", "active")
      .neq("device_id_hash", currentHash)
      .select("id");
    if (error) return json({ ok: false, error: "Revoke failed" }, 500);
    return json({ ok: true, revoked: data?.length ?? 0 });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
