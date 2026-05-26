import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const PREMIUM_ENTITLEMENT_ID = "premium";
export const PREMIUM_CACHE_TTL_MS = 30 * 60 * 1000;

type PremiumAccessSuccess = {
  ok: true;
  user: { id: string; email?: string | null };
  admin: ReturnType<typeof createClient>;
  deviceIdHash: string | null;
  isServiceRole: boolean;
};

type PremiumAccessFailure = {
  ok: false;
  response: Response;
  status: number;
  reason: string;
};

export type PremiumAccessResult = PremiumAccessSuccess | PremiumAccessFailure;

function serviceRoleKeys(): string[] {
  const keys: string[] = [];
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
    "MASTER_SUPABASE_SERVICE_KEY",
  ]) {
    const value = Deno.env.get(name)?.trim();
    if (value && !keys.includes(value)) keys.push(value);
  }
  return keys;
}

function serviceRoleKey(): string | null {
  return serviceRoleKeys()[0] ?? null;
}

function json(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function logSecurityEvent(
  admin: ReturnType<typeof createClient>,
  event: {
    userId?: string | null;
    eventType: string;
    deviceIdHash?: string | null;
    revenuecatAppUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await admin.from("account_security_events").insert({
      user_id: event.userId ?? null,
      event_type: event.eventType,
      device_id_hash: event.deviceIdHash ?? null,
      revenuecat_app_user_id: event.revenuecatAppUserId ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    console.error("account_security_events insert failed:", error);
  }
}

function isFreshCheck(lastCheckedAt: string | null | undefined): boolean {
  if (!lastCheckedAt) return false;
  const ts = new Date(lastCheckedAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts <= PREMIUM_CACHE_TTL_MS;
}

function isUnexpired(latestExpirationAt: string | null | undefined): boolean {
  if (!latestExpirationAt) return true;
  const ts = new Date(latestExpirationAt).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

export async function requirePremiumAccess(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<PremiumAccessResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = serviceRoleKey();

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return {
      ok: false,
      status: 500,
      reason: "server_misconfigured",
      response: json({ error: "Server misconfigured" }, 500, corsHeaders),
    };
  }

  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      reason: "missing_authorization",
      response: json({ error: "Unauthorized" }, 401, corsHeaders),
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (serviceRoleKeys().includes(token)) {
    return {
      ok: true,
      admin,
      user: { id: "service_role" },
      deviceIdHash: null,
      isServiceRole: true,
    };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      reason: "invalid_session",
      response: json({ error: "Invalid session" }, 401, corsHeaders),
    };
  }

  const rawDeviceId = req.headers.get("x-sentinel-device-id");
  const hashSecret = Deno.env.get("DEVICE_ID_HASH_SECRET");
  if (!hashSecret) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "premium_api_device_check_failed",
      metadata: { reason: "missing_device_hash_secret" },
    });
    return {
      ok: false,
      status: 403,
      reason: "device_check_unavailable",
      response: json({ error: "Premium access unavailable" }, 403, corsHeaders),
    };
  }

  if (!rawDeviceId) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "premium_api_device_missing",
      metadata: { reason: "missing_device_header" },
    });
    return {
      ok: false,
      status: 403,
      reason: "device_header_required",
      response: json({ error: "Device verification required" }, 403, corsHeaders),
    };
  }

  const deviceIdHash = await sha256(rawDeviceId + hashSecret);

  const { data: blockedSession, error: blockedError } = await admin
    .from("blocked_sessions")
    .select("id, reason")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .or(deviceIdHash ? `device_id_hash.eq.${deviceIdHash},device_id_hash.is.null` : "device_id_hash.is.null")
    .limit(1)
    .maybeSingle();

  if (blockedError) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "premium_api_block_check_failed",
      deviceIdHash,
      metadata: { error: blockedError.message },
    });
    return {
      ok: false,
      status: 403,
      reason: "security_check_failed",
      response: json({ error: "Premium access unavailable" }, 403, corsHeaders),
    };
  }

  if (blockedSession) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "premium_api_blocked",
      deviceIdHash,
      metadata: { reason: blockedSession.reason },
    });
    return {
      ok: false,
      status: 403,
      reason: "blocked_session",
      response: json({ error: "Premium access unavailable" }, 403, corsHeaders),
    };
  }

  if (deviceIdHash) {
    const { data: device, error: deviceError } = await admin
      .from("user_devices")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("device_id_hash", deviceIdHash)
      .eq("status", "active")
      .maybeSingle();

    if (deviceError || !device) {
      await logSecurityEvent(admin, {
        userId: user.id,
        eventType: "premium_api_device_blocked",
        deviceIdHash,
        metadata: { error: deviceError?.message ?? null },
      });
      return {
        ok: false,
        status: 403,
        reason: "device_not_allowed",
        response: json({ error: "Too many devices are using this account." }, 403, corsHeaders),
      };
    }

    await admin
      .from("user_devices")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", device.id);
  }

  const [{ data: subscription, error: subscriptionError }, { data: override, error: overrideError }] =
    await Promise.all([
      admin
        .from("user_subscription_status")
        .select("is_active, latest_expiration_at, last_checked_at, revenuecat_app_user_id, status_reason")
        .eq("user_id", user.id)
        .eq("entitlement_id", PREMIUM_ENTITLEMENT_ID)
        .maybeSingle(),
      admin
        .from("premium_overrides")
        .select("id, access_type, expires_at")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const hasRevenueCatPremium =
    !!subscription?.is_active &&
    isFreshCheck(subscription.last_checked_at) &&
    isUnexpired(subscription.latest_expiration_at);
  const hasActiveOverride = !!override;
  const hasActivePremium = hasRevenueCatPremium || hasActiveOverride;

  if (!hasActivePremium) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: subscriptionError || overrideError ? "subscription_check_failed" : "premium_api_blocked",
      deviceIdHash,
      revenuecatAppUserId: subscription?.revenuecat_app_user_id ?? null,
      metadata: {
        subscriptionError: subscriptionError?.message ?? null,
        overrideError: overrideError?.message ?? null,
        statusReason: subscription?.status_reason ?? null,
        hasSubscriptionRow: !!subscription,
        hasActiveOverride,
      },
    });
    return {
      ok: false,
      status: 402,
      reason: "premium_required",
      response: json({ error: "Subscription required", code: "PREMIUM_REQUIRED" }, 402, corsHeaders),
    };
  }

  return {
    ok: true,
    admin,
    user: { id: user.id, email: user.email },
    deviceIdHash,
    isServiceRole: false,
  };
}

export async function requireServiceRoleAccess(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<PremiumAccessResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const configuredKeys = serviceRoleKeys();
  const serviceKey = configuredKeys[0] ?? null;
  if (!supabaseUrl || !serviceKey) {
    console.error("[service-role-auth] rejected reason=server_misconfigured");
    return {
      ok: false,
      status: 500,
      reason: "server_misconfigured",
      response: json({ error: "Server misconfigured" }, 500, corsHeaders),
    };
  }

  const token = bearerToken(req);
  if (!configuredKeys.includes(token)) {
    let path = "unknown";
    try {
      path = new URL(req.url).pathname;
    } catch {
      // Use a bounded fallback in logs for malformed request URLs.
    }
    console.warn(
      `[service-role-auth] rejected method=${req.method} path=${path} ` +
        `bearer=${token ? "present" : "missing"} configured_keys=${configuredKeys.length}`,
    );
    return {
      ok: false,
      status: 401,
      reason: "service_role_required",
      response: json({ error: "Unauthorized" }, 401, corsHeaders),
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    ok: true,
    admin,
    user: { id: "service_role" },
    deviceIdHash: null,
    isServiceRole: true,
  };
}
