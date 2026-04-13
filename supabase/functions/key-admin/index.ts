import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function getLocalClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Master DB — tries MASTER_SUPABASE_URL first, validates it works, falls back to local
async function getMasterClient(): Promise<SupabaseClient> {
  const masterUrl = Deno.env.get("MASTER_SUPABASE_URL");
  const masterKey = Deno.env.get("MASTER_SUPABASE_SERVICE_KEY");
  if (masterUrl && masterKey) {
    try {
      const client = createClient(masterUrl, masterKey);
      // Quick validation — check if the required table exists
      const { error } = await client.from("license_keys").select("id").limit(1);
      if (!error) {
        console.log("Using master DB");
        return client;
      }
      console.warn("Master DB failed validation, falling back to local:", error.message);
    } catch (e) {
      console.warn("Master DB connection failed, falling back to local:", e);
    }
  }
  return getLocalClient();
}

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

function generateKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = 4;
  const segLen = 5;
  const parts: string[] = [];
  for (let i = 0; i < segments; i++) {
    let seg = "";
    for (let j = 0; j < segLen; j++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    parts.push(seg);
  }
  return parts.join("-");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = await getMasterClient();

    const adminSecret = Deno.env.get("ADMIN_SECRET_PASSWORD");
    const body = await req.json();
    const { password, action } = body;

    // Verify admin password
    if (!password || password !== adminSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    // IP whitelist check — collect all possible client IPs
    const forwardedFor = req.headers.get("x-forwarded-for") || "";
    const allForwardedIps = forwardedFor.split(",").map((ip: string) => ip.trim()).filter(Boolean);
    const cfIp = req.headers.get("cf-connecting-ip")?.trim();
    const realIp = req.headers.get("x-real-ip")?.trim();
    
    // Primary IP for display
    const clientIp = allForwardedIps[0] || cfIp || realIp || "unknown";

    const { data: whitelistIps } = await supabase
      .from("admin_whitelist_ips")
      .select("ip_address");

    const whitelist = whitelistIps?.map((r: any) => r.ip_address.trim()) || [];

    // If whitelist has entries, enforce it. If empty, allow all (initial setup).
    if (whitelist.length > 0) {
      // Check all possible IPs from the request against the whitelist
      const candidateIps = new Set([clientIp, ...allForwardedIps, cfIp, realIp].filter(Boolean));
      const isAllowed = [...candidateIps].some((ip) => whitelist.includes(ip!));
      if (!isAllowed) {
        return json(
          { error: `Access denied. IP ${clientIp} not whitelisted. Detected IPs: ${[...candidateIps].join(", ")}` },
          403
        );
      }
    }

    switch (action) {
      case "test_api_keys": {
        const { keys: testKeys } = body;
        if (!testKeys || !Array.isArray(testKeys) || testKeys.length === 0) {
          return json({ error: "No keys provided" }, 400);
        }
        const results: Array<{ key: string; valid: boolean; error?: string }> = [];
        for (const k of testKeys.slice(0, 100)) {
          const trimmed = (k as string).trim();
          if (trimmed.length < 10) { results.push({ key: trimmed, valid: false, error: "Too short" }); continue; }
          try {
            const resp = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${trimmed}`);
            if (resp.ok) {
              const remaining = resp.headers.get("x-requests-remaining");
              results.push({ key: trimmed, valid: true, error: remaining ? `${remaining} requests left` : undefined });
            } else {
              results.push({ key: trimmed, valid: false, error: `HTTP ${resp.status}` });
            }
          } catch (e) {
            results.push({ key: trimmed, valid: false, error: "Network error" });
          }
        }
        return json({ results, good: results.filter(r => r.valid).length, bad: results.filter(r => !r.valid).length });
      }

      case "bulk_add_api_keys": {
        const { keys: apiKeys } = body;
        if (!apiKeys || !Array.isArray(apiKeys) || apiKeys.length === 0) {
          return json({ error: "No keys provided" }, 400);
        }
        const cleaned = apiKeys.map((k: string) => k.trim()).filter((k: string) => k.length > 10);
        if (cleaned.length === 0) return json({ error: "No valid keys found" }, 400);

        const { data: existing } = await supabase.from("odds_api_keys").select("api_key");
        const existingSet = new Set((existing || []).map((r: any) => r.api_key));
        const newKeys = cleaned.filter((k: string) => !existingSet.has(k));

        if (newKeys.length === 0) return json({ error: "All keys already exist", duplicates: cleaned.length }, 400);

        const rows = newKeys.map((k: string) => ({ api_key: k, is_active: true }));
        const { error: insertErr } = await supabase.from("odds_api_keys").insert(rows);
        if (insertErr) return json({ error: insertErr.message }, 500);

        return json({ success: true, added: newKeys.length, duplicates: cleaned.length - newKeys.length });
      }

      case "reset_exhausted_keys": {
        const { error: resetErr } = await supabase
          .from("odds_api_keys")
          .update({ exhausted_at: null, last_error: null })
          .not("exhausted_at", "is", null);
        if (resetErr) return json({ error: resetErr.message }, 500);
        return json({ success: true });
      }

      case "generate_key": {
        const { label, max_devices, expires_in_days } = body;
        const key = generateKey();
        const expiresAt = expires_in_days
          ? new Date(
              Date.now() + expires_in_days * 24 * 60 * 60 * 1000
            ).toISOString()
          : null;

        const { data, error } = await supabase
          .from("license_keys")
          .insert({
            key,
            label: label || null,
            max_devices: max_devices || 1,
            expires_at: expiresAt,
          })
          .select()
          .single();

        if (error) return json({ error: error.message }, 500);
        return json({ success: true, key: data });
      }

      case "list_keys": {
        const { data, error } = await supabase
          .from("license_keys")
          .select("*, key_sessions(*)")
          .order("created_at", { ascending: false });

        if (error) return json({ error: error.message }, 500);
        return json({ keys: data });
      }

      case "revoke_key": {
        const { key_id } = body;
        const { error } = await supabase
          .from("license_keys")
          .update({ is_active: false })
          .eq("id", key_id);

        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "activate_key": {
        const { key_id } = body;
        const { error } = await supabase
          .from("license_keys")
          .update({ is_active: true })
          .eq("id", key_id);

        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "clear_sessions": {
        const { key_id } = body;
        const { error } = await supabase
          .from("key_sessions")
          .delete()
          .eq("license_key_id", key_id);

        if (error) return json({ error: error.message }, 500);
        return json({ success: true, message: "Sessions cleared" });
      }

      case "add_whitelist_ip": {
        const { ip } = body;
        const { error } = await supabase
          .from("admin_whitelist_ips")
          .insert({ ip_address: ip });

        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "remove_whitelist_ip": {
        const { ip } = body;
        const { error } = await supabase
          .from("admin_whitelist_ips")
          .delete()
          .eq("ip_address", ip);

        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }

      case "api_key_status": {
        const { data: allKeys, error: keysErr } = await supabase
          .from("odds_api_keys")
          .select("id, is_active, exhausted_at, requests_remaining, requests_used, last_used_at, last_error");
        if (keysErr) return json({ error: keysErr.message }, 500);
        const total = allKeys?.length || 0;
        const active = allKeys?.filter((k: any) => k.is_active && !k.exhausted_at).length || 0;
        const exhausted = allKeys?.filter((k: any) => k.exhausted_at).length || 0;
        const inactive = allKeys?.filter((k: any) => !k.is_active).length || 0;
        const totalRemaining = allKeys?.reduce((s: number, k: any) => s + (k.requests_remaining || 0), 0) || 0;
        const totalUsed = allKeys?.reduce((s: number, k: any) => s + (k.requests_used || 0), 0) || 0;
        return json({ total, active, exhausted, inactive, totalRemaining, totalUsed, keys: allKeys });
      }

      case "list_whitelist": {
        const { data, error } = await supabase
          .from("admin_whitelist_ips")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return json({ error: error.message }, 500);
        const allIps = [...new Set([clientIp, ...allForwardedIps, cfIp, realIp].filter(Boolean))];
        return json({ ips: data, your_ip: clientIp, all_detected_ips: allIps });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: "Internal server error" }, 500);
  }
});
