// Send a single game-start push notification to all of a user's iOS devices
// via APNs HTTP/2. Called by the game-alerts-every-5-min pg_cron job.
//
// On success → marks the game_notifications row alert_sent_at = now() so the
// next cron tick won't re-send. On failure → records alert_status='failed'
// + alert_error so we have a paper trail.
//
// Stale tokens (BadDeviceToken / Unregistered) are deleted from
// mobile_push_tokens automatically.
//
// Vault secrets read at runtime:
//   apns_team_id          — Apple Team ID (10 chars)
//   apns_key_id           — APNs Key ID (10 chars)
//   apns_private_key      — full .p8 file contents (PEM)
//   apns_bundle_id        — e.g. com.sentinelprops.app
//   apns_is_production    — 'true' (TestFlight + App Store) or 'false' (sandbox/dev)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── APNs JWT (ES256) ────────────────────────────────────────────────────────
async function buildApnsJwt(
  teamId: string,
  keyId: string,
  p8PrivateKey: string,
): Promise<string> {
  const pem = p8PrivateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const b64url = (s: string) =>
    btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${sigB64}`;
}

interface SendResult {
  token: string;          // FULL token (used for cleanup of stale tokens)
  success: boolean;
  error?: string;
}

async function sendApnsPush(
  deviceToken: string,
  title: string,
  body: string,
  data: Record<string, string>,
  jwt: string,
  bundleId: string,
  isProd: boolean,
): Promise<SendResult> {
  const host = isProd ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const url = `${host}/3/device/${deviceToken}`;

  const payload = JSON.stringify({
    aps: {
      alert: { title, body },
      sound: "default",
      badge: 1,
    },
    ...data,
  });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "authorization": `bearer ${jwt}`,
        "apns-push-type": "alert",
        "apns-topic": bundleId,
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: payload,
    });

    if (resp.status === 200) {
      return { token: deviceToken, success: true };
    }

    const errBody = await resp.json().catch(() => ({} as { reason?: string }));
    return {
      token: deviceToken,
      success: false,
      error: errBody.reason ?? `HTTP ${resp.status}`,
    };
  } catch (e) {
    return {
      token: deviceToken,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Read APNs Vault secrets ──
  const { data: secrets, error: secretsErr } = await admin
    .from("vault.decrypted_secrets")
    .select("name, decrypted_secret")
    .in("name", [
      "apns_team_id",
      "apns_key_id",
      "apns_private_key",
      "apns_bundle_id",
      "apns_is_production",
    ]);

  if (secretsErr) {
    console.error("[send-game-alert] Vault read failed:", secretsErr.message);
    return new Response(JSON.stringify({ error: "Vault read failed" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sec = Object.fromEntries(
    (secrets ?? []).map((s: { name: string; decrypted_secret: string }) => [
      s.name,
      s.decrypted_secret,
    ]),
  );
  const teamId = sec["apns_team_id"];
  const keyId = sec["apns_key_id"];
  const privateKey = sec["apns_private_key"];
  const bundleId = sec["apns_bundle_id"] ?? "com.sentinelprops.app";
  const isProd = sec["apns_is_production"] !== "false"; // default true

  if (!teamId || !keyId || !privateKey) {
    console.error("[send-game-alert] APNs Vault secrets missing");
    return new Response(JSON.stringify({ error: "APNs not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Parse request ──
  let body: {
    game_notification_id?: string;
    user_id?: string;
    game_id?: string;
    home_team?: string;
    away_team?: string;
    commence_time?: string;
    sport_key?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.game_notification_id || !body.user_id || !body.home_team || !body.away_team) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Fetch this user's enabled iOS device tokens ──
  const { data: tokens, error: tokensErr } = await admin
    .from("mobile_push_tokens")
    .select("device_token")
    .eq("user_id", body.user_id)
    .eq("platform", "ios")
    .eq("enabled", true)
    .not("device_token", "is", null);

  if (tokensErr) {
    console.error("[send-game-alert] Token lookup failed:", tokensErr.message);
    await admin
      .from("game_notifications")
      .update({ alert_status: "failed", alert_error: "token_lookup_failed" })
      .eq("id", body.game_notification_id);
    return new Response(JSON.stringify({ error: "Token lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!tokens || tokens.length === 0) {
    // No tokens — mark as sent so cron stops retrying. The user simply has no
    // registered iOS devices anymore.
    await admin
      .from("game_notifications")
      .update({
        alert_sent_at: new Date().toISOString(),
        alert_status: "sent",
        alert_error: "no_tokens_registered",
      })
      .eq("id", body.game_notification_id);
    return new Response(JSON.stringify({ sent: 0, reason: "no_tokens" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Build content ──
  const title = "Game Starting Soon!";
  const notifBody = `${body.away_team} @ ${body.home_team} starts in 10 minutes`;
  const deepLinkData = {
    screen: "games",
    game_id: body.game_id ?? "",
    sport_key: body.sport_key ?? "",
  };

  // ── One JWT covers all tokens for this invocation (60-min validity) ──
  const jwt = await buildApnsJwt(teamId, keyId, privateKey);

  const results = await Promise.all(
    (tokens as { device_token: string }[]).map((row) =>
      sendApnsPush(row.device_token, title, notifBody, deepLinkData, jwt, bundleId, isProd),
    ),
  );

  const sent = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  // ── Clean up stale tokens (full token available now) ──
  const staleTokens = results
    .filter((r) => r.error === "BadDeviceToken" || r.error === "Unregistered")
    .map((r) => r.token);
  if (staleTokens.length > 0) {
    await admin
      .from("mobile_push_tokens")
      .delete()
      .in("device_token", staleTokens);
    console.log(`[send-game-alert] Removed ${staleTokens.length} stale tokens`);
  }

  // ── Mark game_notifications row according to outcome ──
  if (sent > 0) {
    await admin
      .from("game_notifications")
      .update({
        alert_sent_at: new Date().toISOString(),
        alert_status: "sent",
        alert_error: null,
      })
      .eq("id", body.game_notification_id);
  } else {
    await admin
      .from("game_notifications")
      .update({
        alert_status: "failed",
        alert_error: failed[0]?.error ?? "unknown",
      })
      .eq("id", body.game_notification_id);
  }

  console.log(`[send-game-alert] user=${body.user_id} sent=${sent}/${tokens.length}`);

  return new Response(
    JSON.stringify({ sent, failed: failed.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
