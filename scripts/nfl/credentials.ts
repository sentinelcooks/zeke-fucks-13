/**
 * Server-side credentials for the NFL Node scripts.
 *
 * Order: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (CI), else — only
 * when `--linked` is passed — the project linked in supabase/.temp via the
 * logged-in Supabase CLI. The key is held in memory only; never logged or
 * written to disk.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function resolveServiceCredentials(argv: string[]): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return { url, key };
  if (!argv.includes("--linked")) return null;

  const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("supabase/.temp/project-ref is missing or invalid — run `supabase link`");
  const out = execFileSync("supabase", ["projects", "api-keys", "--project-ref", ref, "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const service = (JSON.parse(out) as Array<{ name: string; api_key: string }>).find((k) => k.name === "service_role");
  if (!service?.api_key) throw new Error("service_role key not returned by `supabase projects api-keys` — are you logged in?");
  return { url: `https://${ref}.supabase.co`, key: service.api_key };
}
