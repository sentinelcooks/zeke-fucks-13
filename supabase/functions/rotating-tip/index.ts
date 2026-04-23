import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FOCUS_AREAS = [
  "Bankroll",
  "Line shopping",
  "Closing line value",
  "Prop correlation",
  "Injury news",
  "Hedging",
  "Variance control",
  "Market timing",
];

function fallbackTip(sports: string[], style: string | null) {
  const sport = sports?.[0] || "your main sport";
  return {
    tip: `Track closing line movement on ${sport} props — if a line shifts toward your pick before tip-off, sharp money agrees with your read.`,
    focus_area: "Closing line value",
  };
}

function hourWindow(userId: string) {
  // 12-13h cache, deterministic per user
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return 12 + (h % 60) / 60; // 12.0 - 13.0
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: row } = await admin
      .from("onboarding_responses")
      .select("referral, sports, betting_style, daily_tip_text, daily_tip_generated_at, daily_tip_seed")
      .eq("user_id", userId)
      .maybeSingle();

    const cacheH = hourWindow(userId);
    if (row?.daily_tip_text && row.daily_tip_generated_at) {
      const ageMs = Date.now() - new Date(row.daily_tip_generated_at).getTime();
      if (ageMs < cacheH * 60 * 60 * 1000) {
        return new Response(JSON.stringify({
          tip: row.daily_tip_text,
          focus_area: FOCUS_AREAS[(row.daily_tip_seed ?? 0) % FOCUS_AREAS.length],
          generated_at: row.daily_tip_generated_at,
          cached: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!row) {
      const fb = fallbackTip([], null);
      return new Response(JSON.stringify({ ...fb, generated_at: new Date().toISOString(), cached: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newSeed = (row.daily_tip_seed ?? 0) + 1;
    const focusHint = FOCUS_AREAS[newSeed % FOCUS_AREAS.length];

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const prompt = `User profile:
- Sports: ${(row.sports || []).join(", ") || "general"}
- Betting style: ${row.betting_style || "unspecified"}
- Found us via: ${row.referral || "unknown"}

Rotation seed: ${newSeed}. Focus this tip on: ${focusHint}.

Write ONE sharp, actionable daily tip (1-2 complete sentences) tailored to this user's sports and style. Reference their specific sport when natural. Give real strategy with concrete numbers/percentages where useful. No generic filler like "do your research" or "bet responsibly". No greetings.`;

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a sharp sports betting strategist. Always respond via the provided tool with complete, grammatically correct sentences." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_tip",
            description: "Emit one rotating daily tip",
            parameters: {
              type: "object",
              properties: {
                tip: { type: "string" },
                focus_area: { type: "string" },
              },
              required: ["tip", "focus_area"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_tip" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429 || aiResp.status === 402) {
        const fb = fallbackTip(row.sports || [], row.betting_style);
        return new Response(JSON.stringify({ ...fb, generated_at: new Date().toISOString(), cached: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI ${aiResp.status}`);
    }

    const aiJson = await aiResp.json();
    const args = aiJson.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { tip: string; focus_area: string };
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = fallbackTip(row.sports || [], row.betting_style);
    }

    const generatedAt = new Date().toISOString();
    await admin
      .from("onboarding_responses")
      .update({
        daily_tip_text: parsed.tip,
        daily_tip_generated_at: generatedAt,
        daily_tip_seed: newSeed,
      })
      .eq("user_id", userId);

    return new Response(JSON.stringify({
      tip: parsed.tip,
      focus_area: parsed.focus_area || focusHint,
      generated_at: generatedAt,
      cached: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("rotating-tip error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
