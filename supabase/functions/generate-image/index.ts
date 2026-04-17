// Generate an image via WaveSpeed.ai (async polling).
// Public endpoint — onboarding is pre-auth.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WAVESPEED_API_KEY = Deno.env.get("WAVESPEED_API_KEY");

const ALLOWED_MODELS = new Set<string>([
  "wavespeed-ai/flux-dev",
  "wavespeed-ai/nano-banana-pro",
  "wavespeed-ai/flux-dev/lora/krea",
  "wavespeed-ai/flux-dev/image-to-image/ultra-fast",
]);
const DEFAULT_MODEL = "wavespeed-ai/flux-dev";

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pollForResult(resultUrl: string): Promise<string | null> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const r = await fetch(resultUrl, {
      headers: { Authorization: `Bearer ${WAVESPEED_API_KEY}` },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[generate-image] poll failed", r.status, t);
      return null;
    }
    const j: any = await r.json();
    const data = j?.data ?? j;
    const status = data?.status;
    if (status === "completed" || status === "succeeded") {
      const outputs = data?.outputs ?? data?.output ?? [];
      const first = Array.isArray(outputs) ? outputs[0] : outputs;
      if (typeof first === "string") return first;
      if (first?.url) return first.url;
      return null;
    }
    if (status === "failed" || status === "error") {
      console.error("[generate-image] generation failed", data?.error);
      return null;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  console.warn("[generate-image] poll timed out");
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!WAVESPEED_API_KEY) {
      console.error("[generate-image] missing WAVESPEED_API_KEY");
      return ok({ imageUrl: null, error: "missing_api_key" });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 1000) {
      return ok({ imageUrl: null, error: "invalid_prompt" }, 400);
    }
    const requestedModel = typeof body?.model === "string" ? body.model.trim() : DEFAULT_MODEL;
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL;

    const submitUrl = `https://api.wavespeed.ai/api/v3/${model}`;
    const submit = await fetch(submitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: { prompt } }),
    });

    if (!submit.ok) {
      const t = await submit.text().catch(() => "");
      console.error("[generate-image] submit failed", submit.status, t, "model=", model);
      return ok({ imageUrl: null, error: `submit_${submit.status}` });
    }

    const submitJson: any = await submit.json();
    const data = submitJson?.data ?? submitJson;

    // If immediate result
    const direct = data?.outputs ?? data?.output;
    if (Array.isArray(direct) && direct.length && (data?.status === "completed" || data?.status === "succeeded")) {
      const first = direct[0];
      const url = typeof first === "string" ? first : first?.url;
      if (url) return ok({ imageUrl: url });
    }

    const resultUrl: string | undefined =
      data?.urls?.get ?? data?.result_url ?? data?.urls?.result;
    const id: string | undefined = data?.id;
    const pollUrl =
      resultUrl ??
      (id ? `https://api.wavespeed.ai/api/v3/predictions/${id}/result` : undefined);

    if (!pollUrl) {
      console.error("[generate-image] no poll url in response", submitJson);
      return ok({ imageUrl: null, error: "no_poll_url" });
    }

    const imageUrl = await pollForResult(pollUrl);
    return ok({ imageUrl });
  } catch (e) {
    console.error("[generate-image] uncaught", e);
    return ok({ imageUrl: null, error: "exception" });
  }
});
