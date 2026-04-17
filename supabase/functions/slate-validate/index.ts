// Admin-only validator — proxies slate-scanner in dry-run mode
// and returns full math + sanity flags without DB writes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const adminPass = req.headers.get("x-admin-pass") || url.searchParams.get("adminPass");
  if (adminPass !== Deno.env.get("ADMIN_SECRET_PASSWORD")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/slate-scanner?dryRun=true`, {
    headers: { Authorization: `Bearer ${svc}`, apikey: svc },
  });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
