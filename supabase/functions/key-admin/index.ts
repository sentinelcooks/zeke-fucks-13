import { getMasterClient } from "../_shared/masterClient.ts";
import { loadKeyPoolStats, recheckKeys } from "../_shared/oddsKeyPool.ts";

// Same trim-only normalization the migration used. Odds API keys are
// case-sensitive — do NOT lowercase. sha256 via Web Crypto so we never read
// the raw key back out of the DB in code paths that ship it.
async function hashKey(raw: string): Promise<string> {
  const buf = new TextEncoder().encode(raw.trim());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
        // Normalize = trim only. Keys are case-sensitive.
        const cleanedRaw = apiKeys.map((k: string) => k.trim()).filter((k: string) => k.length > 10);
        if (cleanedRaw.length === 0) return json({ error: "No valid keys found" }, 400);

        // Compute hashes and drop in-batch duplicates by hash.
        const seenHash = new Set<string>();
        const batch: Array<{ raw: string; hash: string }> = [];
        for (const raw of cleanedRaw) {
          const h = await hashKey(raw);
          if (seenHash.has(h)) continue;
          seenHash.add(h);
          batch.push({ raw, hash: h });
        }

        // Find pre-existing non-disabled hashes (partial unique index is
        // WHERE status <> 'disabled' so duplicates of disabled rows are allowed).
        const hashes = batch.map((b) => b.hash);
        const { data: existing } = await supabase
          .from("odds_api_keys")
          .select("api_key_hash")
          .neq("status", "disabled")
          .in("api_key_hash", hashes);
        const existingHashes = new Set((existing || []).map((r: any) => r.api_key_hash));

        const toInsert = batch.filter((b) => !existingHashes.has(b.hash));
        if (toInsert.length === 0) {
          return json({ added: 0, duplicates: cleanedRaw.length, raceConflicts: 0 });
        }

        // Insert one row at a time so we can attribute unique-violations
        // (the partial index serves as a last-line race guard) to specific keys
        // without aborting the whole batch.
        let added = 0;
        let raceConflicts = 0;
        for (const b of toInsert) {
          const { error: insertErr } = await supabase
            .from("odds_api_keys")
            .insert({ api_key: b.raw, api_key_hash: b.hash, status: "unknown", is_active: true });
          if (insertErr) {
            // 23505 = unique_violation
            if ((insertErr as any).code === "23505" || /duplicate key|unique/i.test(insertErr.message)) {
              raceConflicts += 1;
              continue;
            }
            return json({ error: insertErr.message }, 500);
          }
          added += 1;
        }

        return json({
          added,
          duplicates: cleanedRaw.length - added - raceConflicts,
          raceConflicts,
        });
      }

      case "recheck_keys": {
        const batchSize = Number.isFinite(body?.batchSize) ? Math.max(1, Math.min(500, Number(body.batchSize))) : 100;
        const result = await recheckKeys(supabase, batchSize);
        return json({ success: true, ...result });
      }

      case "dedupe_keys": {
        // Group by api_key_hash. Keep the oldest row in each group. Mark the
        // rest status='disabled', last_error='duplicate'. Disabled rows are
        // retained for audit — the partial unique index lets them coexist.
        const { data: rows, error: fetchErr } = await supabase
          .from("odds_api_keys")
          .select("id, api_key_hash, created_at, status")
          .neq("status", "disabled")
          .order("created_at", { ascending: true });
        if (fetchErr) return json({ error: fetchErr.message }, 500);

        const groups = new Map<string, Array<{ id: string; created_at: string }>>();
        for (const r of rows ?? []) {
          if (!r.api_key_hash) continue;
          const arr = groups.get(r.api_key_hash) ?? [];
          arr.push({ id: r.id, created_at: r.created_at });
          groups.set(r.api_key_hash, arr);
        }

        const toDisable: string[] = [];
        let dupGroups = 0;
        for (const arr of groups.values()) {
          if (arr.length < 2) continue;
          dupGroups += 1;
          // arr is already in created_at ASC order; keep the first.
          for (let i = 1; i < arr.length; i++) toDisable.push(arr[i].id);
        }

        let duplicatesDisabled = 0;
        // Update in chunks to keep payloads small.
        for (let i = 0; i < toDisable.length; i += 200) {
          const chunk = toDisable.slice(i, i + 200);
          const { error: upErr, count } = await supabase
            .from("odds_api_keys")
            .update({ status: "disabled", last_error: "duplicate" }, { count: "exact" })
            .in("id", chunk);
          if (upErr) return json({ error: upErr.message }, 500);
          duplicatesDisabled += count ?? chunk.length;
        }

        return json({ success: true, groups: dupGroups, duplicatesDisabled });
      }

      case "delete_invalid_keys": {
        // Only delete rows the system has independently confirmed are dead:
        // status='invalid_auth' AND consecutive_errors >= 3. Server-side gate;
        // the admin UI also asks for confirmation but that is advisory only.
        const { error: delErr, count } = await supabase
          .from("odds_api_keys")
          .delete({ count: "exact" })
          .eq("status", "invalid_auth")
          .gte("consecutive_errors", 3);
        if (delErr) return json({ error: delErr.message }, 500);
        return json({ success: true, deleted: count ?? 0 });
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
        // Single source of truth shared with odds-health-check. Numbers MUST
        // match because both endpoints query the same DB via _shared/masterClient.
        const stats = await loadKeyPoolStats(supabase);
        // Backward-compat aliases so the existing AdminPage render does not
        // break before its own update lands.
        return json({
          ...stats,
          active: stats.byStatus.available,
          exhausted: stats.byStatus.exhausted_quota + stats.byStatus.invalid_auth + stats.byStatus.rate_limited,
          inactive: stats.byStatus.disabled,
          totalRemaining: stats.usableRequestsRemaining,
        });
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
