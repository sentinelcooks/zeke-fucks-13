import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, AIProviderError, ANTI_GENERIC_INSTRUCTION } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { prop_value, prop_label, sport, betting_level } = await req.json();

    if (!prop_value || !prop_label) {
      return new Response(
        JSON.stringify({ error: "prop_value and prop_label are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const level = betting_level || "beginner";
    const sportName = sport || "nba";

    // Check cache first
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: cached } = await supabase
      .from("prop_explanations")
      .select("explanation, example")
      .eq("prop_value", prop_value)
      .eq("sport", sportName)
      .eq("betting_level", level)
      .maybeSingle();

    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate with AI
    const sportLabel = sportName === "nba" ? "NBA basketball" : sportName === "mlb" ? "MLB baseball" : sportName === "nhl" ? "NHL hockey" : "UFC MMA";

    const levelPrompts: Record<string, string> = {
      beginner:
        "Use simple, clear language. Define any betting terminology. Keep it concise.",
      intermediate:
        "Assume basic betting knowledge. Be precise and direct.",
      expert:
        "Be extremely brief. Technical language is fine.",
    };

    const systemPrompt = `You are Sentinel AI, a sports betting analytics engine specializing in ${sportLabel} prop analysis. ${levelPrompts[level] || levelPrompts.beginner}

Return a JSON object with exactly two fields:
- "explanation": A precise 1-2 sentence definition of the "${prop_label}" prop in ${sportLabel}. Do NOT include internal stat codes or variable names — only use the display label "${prop_label}" and its full name.
- "example": A concise betting example using a real ${sportLabel} player name demonstrating a winning outcome.

Be analytical and direct. No filler. No markdown, no extra fields. Make sure the explanation is specific to ${sportLabel} — do not confuse sports.

${ANTI_GENERIC_INSTRUCTION}`;

    const aiResult = await callAI({
      fnName: "prop-explainer",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Explain the "${prop_label}" prop (value: ${prop_value}) in ${sportLabel} for a ${level} bettor.`,
        },
      ],
      tool: {
        name: "explain_prop",
        description: "Return a prop explanation and example",
        parameters: {
          type: "object",
          properties: {
            explanation: { type: "string" },
            example: { type: "string" },
          },
          required: ["explanation", "example"],
          additionalProperties: false,
        },
      },
      maxTokens: 300,
    });

    const result = aiResult.output as { explanation: string; example: string };

    // Cache it
    await supabase.from("prop_explanations").upsert(
      {
        prop_value,
        sport: sportName,
        betting_level: level,
        explanation: result.explanation,
        example: result.example,
      },
      { onConflict: "prop_value,sport,betting_level" }
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("prop-explainer error:", e);
    if (e instanceof AIProviderError) {
      return new Response(
        JSON.stringify({ error: "AI explanation unavailable. Please try again shortly." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
