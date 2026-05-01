// Phone device verification — enforces one active phone per Supabase user.
// Called by the iOS app right after auth resolves. Returns whether the device
// is allowed and, if blocked, the active device list so the user can revoke
// the old phone via manage-phone-devices.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_DEVICE_LIMIT = 1;
const EXEMPT_DEVICE_LIMIT = 999;

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

function isExempt(userId: string): boolean {
  const raw = Deno.env.get("DEVICE_LIMIT_EXEMPT_USER_IDS") ?? "";
  if (!raw) return false;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(userId.toLowerCase());
}

function normalizePlatform(p: unknown): "ios" | "android" {
  return p === "android" ? "android" : "ios";
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

  let body: { deviceId?: unknown; platform?: unknown; deviceLabel?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!isUuidLike(body.deviceId)) return json({ ok: false, error: "Invalid deviceId" }, 400);
  const deviceId = body.deviceId as string;
  const platform = normalizePlatform(body.platform);
  const deviceLabel =
    typeof body.deviceLabel === "string" && body.deviceLabel.length <= 64
      ? body.deviceLabel
      : null;

  const deviceHash = await sha256(deviceId + HASH_SECRET);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const limit = isExempt(user.id) ? EXEMPT_DEVICE_LIMIT : DEFAULT_DEVICE_LIMIT;

  // Look up an existing row for this exact (user, device).
  const { data: existing, error: lookupErr } = await admin
    .from("user_devices")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("device_id_hash", deviceHash)
    .maybeSingle();
  if (lookupErr) return json({ ok: false, error: "Lookup failed" }, 500);

  if (existing && existing.status === "active") {
    await admin
      .from("user_devices")
      .update({
        last_seen: new Date().toISOString(),
        device_label: deviceLabel ?? undefined,
        platform,
      })
      .eq("id", existing.id);

    const { count } = await admin
      .from("user_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "active");

    return json({
      ok: true,
      allowed: true,
      deviceLimit: limit,
      activeDeviceCount: count ?? 1,
    });
  }

  // Either no row or a previously-revoked row for this device — count active
  // devices and decide whether to re-activate / insert.
  const { count: activeCount, error: countErr } = await admin
    .from("user_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active");
  if (countErr) return json({ ok: false, error: "Count failed" }, 500);

  const active = activeCount ?? 0;
  if (active >= limit) {
    const { data: devices } = await admin
      .from("user_devices")
      .select("id, platform, device_label, first_seen, last_seen")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("last_seen", { ascending: false });

    return json({
      ok: false,
      allowed: false,
      reason: "DEVICE_LIMIT_REACHED",
      deviceLimit: limit,
      activeDeviceCount: active,
      devices: devices ?? [],
    });
  }

  if (existing) {
    // Re-activate the previously-revoked row for this device.
    await admin
      .from("user_devices")
      .update({
        status: "active",
        revoked_at: null,
        last_seen: new Date().toISOString(),
        device_label: deviceLabel ?? undefined,
        platform,
      })
      .eq("id", existing.id);
  } else {
    await admin.from("user_devices").insert({
      user_id: user.id,
      device_id_hash: deviceHash,
      platform,
      device_label: deviceLabel,
    });
  }

  return json({
    ok: true,
    allowed: true,
    deviceLimit: limit,
    activeDeviceCount: active + 1,
  });
});
