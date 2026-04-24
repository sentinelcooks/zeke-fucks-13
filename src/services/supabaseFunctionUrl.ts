/**
 * Shared helper for constructing Supabase Edge Function URLs.
 * Always derive from VITE_SUPABASE_URL when present; fall back to
 * VITE_SUPABASE_PROJECT_ID for backwards compatibility with older deploys.
 */
export function getFunctionUrl(path: string): string {
  const explicitUrl = import.meta.env.VITE_SUPABASE_URL;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const base = explicitUrl || (projectId ? `https://${projectId}.supabase.co` : "");
  if (!base) {
    throw new Error("Supabase URL not configured (set VITE_SUPABASE_URL on Vercel)");
  }
  return `${base.replace(/\/$/, "")}/functions/v1/${path.replace(/^\//, "")}`;
}

export function getSupabaseAnonKey(): string {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error("Supabase anon key not configured (set VITE_SUPABASE_PUBLISHABLE_KEY)");
  }
  return key;
}
