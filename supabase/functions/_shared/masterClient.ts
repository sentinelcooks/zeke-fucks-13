import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Returns the local Supabase client (the function's own project).
 */
export function getLocalClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Returns the master Supabase client when MASTER_SUPABASE_URL +
 * MASTER_SUPABASE_SERVICE_KEY are configured. Validates by querying
 * `odds_api_keys`. Falls back to the local client on any failure so
 * Edge Functions remain functional in single-project deploys.
 *
 * All functions that read/write the rotation pool (`odds_api_keys`)
 * or admin-uploaded config MUST use this so they share state with
 * `key-admin` and the Admin Dashboard.
 */
export async function getMasterClient(): Promise<SupabaseClient> {
  const masterUrl = Deno.env.get("MASTER_SUPABASE_URL");
  const masterKey = Deno.env.get("MASTER_SUPABASE_SERVICE_KEY");
  if (masterUrl && masterKey) {
    try {
      const client = createClient(masterUrl, masterKey);
      const { error } = await client.from("odds_api_keys").select("id").limit(1);
      if (!error) return client;
      console.warn("[masterClient] Master DB ping failed, falling back to local:", error.message);
    } catch (e) {
      console.warn("[masterClient] Master DB connection failed, falling back to local:", e);
    }
  }
  return getLocalClient();
}

export function masterDbConfigured(): boolean {
  return Boolean(Deno.env.get("MASTER_SUPABASE_URL") && Deno.env.get("MASTER_SUPABASE_SERVICE_KEY"));
}
