import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

// ── HMAC-signed token with embedded expiry ──
const SESSION_TTL_HOURS = 24;

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createSignedToken(sessionId: string, secret: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const payload = `${sessionId}.${expiresAt.getTime()}`;
  const signature = await hmacSign(payload, secret);
  return { token: `${payload}.${signature}`, expiresAt };
}

async function verifySignedToken(token: string, secret: string): Promise<{ valid: boolean; sessionId?: string; expired?: boolean }> {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false };

  const [sessionId, expiresAtStr, signature] = parts;
  const payload = `${sessionId}.${expiresAtStr}`;
  const expectedSig = await hmacSign(payload, secret);

  if (signature !== expectedSig) return { valid: false };

  const expiresAt = parseInt(expiresAtStr, 10);
  if (Date.now() > expiresAt) return { valid: false, sessionId, expired: true };

  return { valid: true, sessionId };
}

// ── Fingerprint drift detection ──
const DRIFT_WINDOW_DAYS = 7;
const MAX_UNIQUE_FINGERPRINTS = 5;

async function checkFingerprintDrift(
  supabase: any,
  licenseKeyId: string,
  fingerprint: string,
  ipAddress: string,
  userAgent: string
): Promise<{ blocked: boolean; reason?: string }> {
  // Log this fingerprint
  await supabase.from("fingerprint_log").insert({
    license_key_id: licenseKeyId,
    device_fingerprint: fingerprint,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // Count unique fingerprints for this key in the last N days
  const windowStart = new Date(Date.now() - DRIFT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs } = await supabase
    .from("fingerprint_log")
    .select("device_fingerprint")
    .eq("license_key_id", licenseKeyId)
    .gte("logged_at", windowStart);

  const uniqueFingerprints = new Set((logs || []).map((l: any) => l.device_fingerprint));

  if (uniqueFingerprints.size > MAX_UNIQUE_FINGERPRINTS) {
    return {
      blocked: true,
      reason: `Suspicious activity: ${uniqueFingerprints.size} unique devices detected in ${DRIFT_WINDOW_DAYS} days. Key locked.`,
    };
  }

  return { blocked: false };
}

const RATE_LIMIT_WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_PER_WINDOW = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const hmacSecret = Deno.env.get("HMAC_SECRET") || "fallback-change-me";

    const body = await req.json();
    const { action } = body;

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    // ── VALIDATE SESSION ──
    if (action === "validate") {
      const { session_token, fingerprint, user_agent } = body;
      if (!session_token || !fingerprint) {
        return json({ valid: false, error: "Missing fields" }, 400);
      }

      // Verify HMAC signature and expiry from the token itself
      const tokenResult = await verifySignedToken(session_token, hmacSecret);
      if (!tokenResult.valid) {
        if (tokenResult.expired) {
          // Clean up expired session
          if (tokenResult.sessionId) {
            await supabase
              .from("key_sessions")
              .update({ session_token: null, token_expires_at: null })
              .eq("id", tokenResult.sessionId);
          }
          return json({ valid: false, error: "Session expired", expired: true }, 401);
        }
        return json({ valid: false, error: "Invalid token signature" }, 401);
      }

      // Verify session exists in DB
      const { data: session } = await supabase
        .from("key_sessions")
        .select("*, license_keys(*)")
        .eq("id", tokenResult.sessionId)
        .eq("is_blocked", false)
        .single();

      if (!session) {
        return json({ valid: false, error: "Invalid or blocked session" }, 401);
      }

      // Check token matches what's stored
      if (session.session_token !== session_token) {
        return json({ valid: false, error: "Session superseded (concurrent login)" }, 401);
      }

      // Fingerprint can drift in some browsers between restarts.
      // Allow a rotate only if user-agent hash still matches the stored device profile.
      const currentUaHash = user_agent ? await sha256(user_agent) : null;
      if (session.device_fingerprint !== fingerprint) {
        if (!currentUaHash || session.ua_hash !== currentUaHash) {
          return json({ valid: false, error: "Invalid session fingerprint" }, 401);
        }

        await supabase
          .from("key_sessions")
          .update({
            device_fingerprint: fingerprint,
            user_agent: user_agent || session.user_agent,
            last_seen_at: new Date().toISOString(),
            ip_address: clientIp,
          })
          .eq("id", session.id);
      } else {
        await supabase
          .from("key_sessions")
          .update({ last_seen_at: new Date().toISOString(), ip_address: clientIp })
          .eq("id", session.id);
      }

      const key = session.license_keys as any;
      if (!key?.is_active) {
        return json({ valid: false, error: "License key deactivated" }, 403);
      }
      if (key?.expires_at && new Date(key.expires_at) < new Date()) {
        return json({ valid: false, error: "License key expired" }, 403);
      }

      // DB-level expiry check as backup
      if (session.token_expires_at && new Date(session.token_expires_at) < new Date()) {
        await supabase
          .from("key_sessions")
          .update({ session_token: null, token_expires_at: null })
          .eq("id", session.id);
        return json({ valid: false, error: "Session expired", expired: true }, 401);
      }

      return json({ valid: true, label: key.label });
    }

    // ── LOGIN FLOW ──
    const { key, fingerprint, user_agent } = body;

    if (!key || !fingerprint || !user_agent) {
      return json({ error: "Missing required fields" }, 400);
    }

    // Rate limiting
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    const { count: recentAttempts } = await supabase
      .from("login_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", clientIp)
      .eq("success", false)
      .gte("attempted_at", windowStart);

    if ((recentAttempts || 0) >= MAX_ATTEMPTS_PER_WINDOW) {
      return json({ error: "Too many failed attempts. Try again later." }, 429);
    }

    const uaHash = await sha256(user_agent);
    const ipHash = await sha256(clientIp);

    // 1. Look up the license key
    const { data: licenseKey, error: keyErr } = await supabase
      .from("license_keys")
      .select("*")
      .eq("key", key)
      .single();

    if (keyErr || !licenseKey) {
      await supabase.from("login_attempts").insert({ ip_address: clientIp, success: false });
      return json({ error: "Invalid license key" }, 401);
    }

    if (!licenseKey.is_active) {
      await supabase.from("login_attempts").insert({ ip_address: clientIp, success: false });
      return json({ error: "License key has been deactivated" }, 403);
    }

    if (licenseKey.expires_at && new Date(licenseKey.expires_at) < new Date()) {
      await supabase.from("login_attempts").insert({ ip_address: clientIp, success: false });
      return json({ error: "License key has expired" }, 403);
    }

    // 2. Fingerprint drift detection
    const drift = await checkFingerprintDrift(supabase, licenseKey.id, fingerprint, clientIp, user_agent);
    if (drift.blocked) {
      // Auto-deactivate the key
      await supabase.from("license_keys").update({ is_active: false }).eq("id", licenseKey.id);
      await supabase.from("login_attempts").insert({ ip_address: clientIp, success: false });
      return json({ error: drift.reason }, 403);
    }

    // 3. Check existing sessions
    const { data: sessions } = await supabase
      .from("key_sessions")
      .select("*")
      .eq("license_key_id", licenseKey.id)
      .eq("is_blocked", false);

    const existingSession = sessions?.find(
      (s: any) => s.device_fingerprint === fingerprint
    );

    if (existingSession) {
      if (existingSession.ua_hash !== uaHash) {
        await supabase.from("key_sessions").update({ is_blocked: true }).eq("id", existingSession.id);
        await supabase.from("login_attempts").insert({ ip_address: clientIp, success: false });
        return json({ error: "Session blocked: device mismatch detected" }, 403);
      }

      // Generate HMAC-signed token with expiry
      const { token, expiresAt } = await createSignedToken(existingSession.id, hmacSecret);

      // Invalidate all OTHER sessions for this key (concurrent session kick)
      await supabase
        .from("key_sessions")
        .update({ session_token: null, token_expires_at: null })
        .eq("license_key_id", licenseKey.id)
        .neq("id", existingSession.id);

      await supabase
        .from("key_sessions")
        .update({
          last_seen_at: new Date().toISOString(),
          ip_hash: ipHash,
          ip_address: clientIp,
          user_agent: user_agent,
          session_token: token,
          token_expires_at: expiresAt.toISOString(),
        })
        .eq("id", existingSession.id);

      await supabase.from("login_attempts").insert({ ip_address: clientIp, success: true });

      return json({
        success: true,
        session_token: token,
        key_id: licenseKey.id,
        label: licenseKey.label,
        expires_at: expiresAt.toISOString(),
      });
    }

    // 4. New device — check device limit
    const activeCount = sessions?.length || 0;
    if (activeCount >= licenseKey.max_devices) {
      await supabase.from("login_attempts").insert({ ip_address: clientIp, success: false });
      return json({
        error: `Device limit reached (${licenseKey.max_devices}). This key is already bound to another device.`,
      }, 403);
    }

    // 5. Bind new device — invalidate old sessions (concurrent kick)
    if (sessions && sessions.length > 0) {
      await supabase
        .from("key_sessions")
        .update({ session_token: null, token_expires_at: null })
        .eq("license_key_id", licenseKey.id);
    }

    const tempId = crypto.randomUUID();
    const { error: insertErr } = await supabase.from("key_sessions").insert({
      id: tempId,
      license_key_id: licenseKey.id,
      device_fingerprint: fingerprint,
      ua_hash: uaHash,
      ip_hash: ipHash,
      ip_address: clientIp,
      user_agent: user_agent,
    });

    if (insertErr) {
      return json({ error: "Failed to create session" }, 500);
    }

    // Now sign the token with the actual session ID
    const { token, expiresAt } = await createSignedToken(tempId, hmacSecret);

    await supabase
      .from("key_sessions")
      .update({ session_token: token, token_expires_at: expiresAt.toISOString() })
      .eq("id", tempId);

    await supabase.from("login_attempts").insert({ ip_address: clientIp, success: true });

    return json({
      success: true,
      session_token: token,
      key_id: licenseKey.id,
      label: licenseKey.label,
      expires_at: expiresAt.toISOString(),
      message: "Device bound successfully",
    });
  } catch (_e) {
    return json({ error: "Internal server error" }, 500);
  }
});
