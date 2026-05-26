import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PREMIUM_ENTITLEMENT_ID } from "../_shared/premium-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sentinel-device-id",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isFutureDate(value: unknown): boolean {
  if (!value || typeof value !== "string") return false;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

function nullableDate(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function pickSubscription(subscriber: any, productId: string | null): any | null {
  const subscriptions = subscriber?.subscriptions ?? {};
  if (productId && subscriptions[productId]) return subscriptions[productId];
  const entries = Object.entries(subscriptions) as Array<[string, any]>;
  if (entries.length === 0) return null;
  entries.sort(([, a], [, b]) => {
    const aTime = new Date(a?.expires_date ?? a?.purchase_date ?? 0).getTime();
    const bTime = new Date(b?.expires_date ?? b?.purchase_date ?? 0).getTime();
    return bTime - aTime;
  });
  return entries[0][1] ?? null;
}

function subscriptionProductIds(subscriber: any): string[] {
  return Object.keys(subscriber?.subscriptions ?? {});
}

async function findActivePremiumOverride(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  return admin
    .from("premium_overrides")
    .select("access_type, expires_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function logSecurityEvent(
  admin: ReturnType<typeof createClient>,
  payload: {
    userId: string;
    eventType: string;
    revenuecatAppUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await admin.from("account_security_events").insert({
      user_id: payload.userId,
      event_type: payload.eventType,
      revenuecat_app_user_id: payload.revenuecatAppUserId ?? null,
      metadata: payload.metadata ?? {},
    });
  } catch (error) {
    console.error("security event insert failed:", error);
  }
}

async function upsertSubscriptionStatus(
  admin: ReturnType<typeof createClient>,
  userId: string,
  revenuecatAppUserId: string,
  subscriber: any | null,
  statusReason: string,
) {
  const entitlement = subscriber?.entitlements?.[PREMIUM_ENTITLEMENT_ID] ?? null;
  const productId =
    entitlement?.product_identifier ??
    entitlement?.product_id ??
    null;
  const subscription = pickSubscription(subscriber, productId);
  const expiresAt =
    nullableDate(entitlement?.expires_date) ??
    nullableDate(subscription?.expires_date);
  const isActive = !!entitlement && (!expiresAt || isFutureDate(expiresAt));
  const periodType = String(subscription?.period_type ?? entitlement?.period_type ?? "").toLowerCase();

  const row = {
    user_id: userId,
    revenuecat_app_user_id: revenuecatAppUserId,
    original_app_user_id: subscriber?.original_app_user_id ?? null,
    original_transaction_id:
      subscription?.original_transaction_id ??
      entitlement?.original_transaction_id ??
      null,
    entitlement_id: PREMIUM_ENTITLEMENT_ID,
    is_active: isActive,
    product_id: productId ?? null,
    current_period_starts_at:
      nullableDate(subscription?.purchase_date) ??
      nullableDate(entitlement?.purchase_date),
    current_period_ends_at: expiresAt,
    trial_started_at: periodType === "trial"
      ? nullableDate(subscription?.purchase_date) ?? nullableDate(entitlement?.purchase_date)
      : null,
    trial_ends_at: periodType === "trial" ? expiresAt : null,
    latest_expiration_at: expiresAt,
    will_renew:
      subscription
        ? !subscription.unsubscribe_detected_at && !subscription.billing_issues_detected_at
        : null,
    status_reason: statusReason,
    last_checked_at: new Date().toISOString(),
    raw_revenuecat: subscriber ?? {},
  };

  const { error } = await admin
    .from("user_subscription_status")
    .upsert(row, { onConflict: "user_id,entitlement_id" });
  if (error) throw error;

  return { isActive, entitlement, productId, subscription, expiresAt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rcSecretKey = Deno.env.get("REVENUECAT_SECRET_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ status: "error", error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json({ status: "error", error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ status: "error", error: "Invalid session" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: premiumOverride, error: overrideError } = await findActivePremiumOverride(admin, user.id);
  if (overrideError) {
    console.error("Premium override check failed:", overrideError.message);
  }
  if (premiumOverride) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "premium_override_active",
      metadata: {
        accessType: premiumOverride.access_type,
        expiresAt: premiumOverride.expires_at ?? null,
      },
    });
    return json({
      status: "active",
      isPremium: true,
      isSubscribed: false,
      lifetimeAccess: premiumOverride.expires_at === null,
      accessSource: "premium_override",
      accessType: premiumOverride.access_type,
      expiresAt: premiumOverride.expires_at ?? null,
      activeSubscriptions: [],
    });
  }

  if (!rcSecretKey) {
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "subscription_check_failed",
      revenuecatAppUserId: user.id,
      metadata: { reason: "revenuecat_not_configured" },
    });
    return json({ status: "error", isPremium: false, isSubscribed: false, lifetimeAccess: false }, 500);
  }

  const revenuecatAppUserId = user.id;

  try {
    const rcResponse = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(revenuecatAppUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${rcSecretKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (rcResponse.status === 404) {
      await upsertSubscriptionStatus(admin, user.id, revenuecatAppUserId, null, "not_found");
      await logSecurityEvent(admin, {
        userId: user.id,
        eventType: "premium_entitlement_inactive",
        revenuecatAppUserId,
        metadata: { reason: "revenuecat_subscriber_not_found" },
      });
      return json({
        status: "inactive",
        isPremium: false,
        isSubscribed: false,
        lifetimeAccess: false,
        accessSource: null,
        entitlements: { [PREMIUM_ENTITLEMENT_ID]: false },
        activeSubscriptions: [],
      });
    }

    if (!rcResponse.ok) {
      const errText = await rcResponse.text().catch(() => "");
      console.error("RevenueCat API error:", rcResponse.status, errText);
      await logSecurityEvent(admin, {
        userId: user.id,
        eventType: "subscription_check_failed",
        revenuecatAppUserId,
        metadata: { status: rcResponse.status, body: errText.slice(0, 500) },
      });
      return json({ status: "error", isPremium: false, isSubscribed: false, lifetimeAccess: false }, 502);
    }

    const rcData = await rcResponse.json();
    const subscriber = rcData.subscriber ?? {};
    const entitlement = subscriber?.entitlements?.[PREMIUM_ENTITLEMENT_ID] ?? null;
    const expiresAt = nullableDate(entitlement?.expires_date);
    const statusReason =
      entitlement && (!expiresAt || isFutureDate(expiresAt))
        ? "active"
        : entitlement
          ? "expired"
          : "missing_entitlement";

    const synced = await upsertSubscriptionStatus(
      admin,
      user.id,
      revenuecatAppUserId,
      subscriber,
      statusReason,
    );

    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: synced.isActive ? "premium_entitlement_active" : "premium_entitlement_inactive",
      revenuecatAppUserId,
      metadata: {
        statusReason,
        productId: synced.productId,
        expiresAt: synced.expiresAt,
        originalAppUserId: subscriber?.original_app_user_id ?? null,
        originalTransactionId:
          synced.subscription?.original_transaction_id ??
          synced.entitlement?.original_transaction_id ??
          null,
      },
    });

    return json({
      status: synced.isActive ? "active" : "inactive",
      isPremium: synced.isActive,
      isSubscribed: synced.isActive,
      lifetimeAccess: false,
      accessSource: synced.isActive ? "revenuecat" : null,
      entitlements: { [PREMIUM_ENTITLEMENT_ID]: synced.isActive },
      activeSubscriptions: subscriptionProductIds(subscriber),
      revenuecatAppUserId,
      productId: synced.productId,
      expiresAt: synced.expiresAt,
    });
  } catch (err) {
    console.error("Entitlement check error:", err);
    await logSecurityEvent(admin, {
      userId: user.id,
      eventType: "subscription_check_failed",
      revenuecatAppUserId,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return json({ status: "error", isPremium: false, isSubscribed: false, lifetimeAccess: false }, 500);
  }
});
