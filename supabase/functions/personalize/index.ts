import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, AIProviderError, PERSONALIZATION_INSTRUCTION } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { referral, sports, betting_style } = await req.json();

    const prompt = `You are a sharp sports betting strategist. Based on the user's onboarding answers, generate actionable, expert-level recommendations. Write in clear, grammatically correct English — no sentence fragments.

User Profile:
- Found us via: ${referral || "Unknown"}
- Sports they bet on: ${(sports || []).join(", ") || "None selected"}
- Betting style: ${betting_style || "Not specified"}

Generate a JSON object with these fields:
1. "welcome_message" - A personalized welcome message (1-2 complete sentences) referencing their interests.
2. "daily_tip" - A sharp, actionable betting tip tailored to their style and sports (1-2 complete sentences). Use clear, natural grammar — no awkward phrasing. Give real strategy — e.g. "Track closing line movement on player props. If a line shifts toward your pick before tip-off, it confirms sharp money agrees with you." Avoid generic advice like "do your research" or "bet responsibly."
3. "recommended_features" - Array of 3 feature suggestions from: ["props", "moneyline", "parlay", "arbitrage", "trends", "tracker", "free-picks", "free-props"]. Pick the most relevant based on their style.
4. "focus_sport" - The primary sport they should focus on (pick from their selected sports).
5. "risk_level" - "low", "medium", or "high" based on their betting style.
6. "bankroll_tip" - A specific bankroll management tip (1 complete sentence). Use concrete numbers or percentages.

Be specific, actionable, and expert-level. Use complete sentences with proper grammar. Match the tone to their experience level.`;

    let recommendations;
    try {
      const aiResult = await callAI({
        fnName: "personalize",
        messages: [
          { role: "system", content: `You are an expert sports betting strategist. Always respond with valid JSON only, no markdown formatting. Use complete sentences with proper grammar. ${PERSONALIZATION_INSTRUCTION}` },
          { role: "user", content: prompt },
        ],
        tool: {
          name: "personalize_app",
          description: "Return personalized recommendations for the user",
          parameters: {
            type: "object",
            properties: {
              welcome_message: { type: "string" },
              daily_tip: { type: "string" },
              recommended_features: {
                type: "array",
                items: { type: "string" },
              },
              focus_sport: { type: "string" },
              risk_level: { type: "string", enum: ["low", "medium", "high"] },
              bankroll_tip: { type: "string" },
            },
            required: ["welcome_message", "daily_tip", "recommended_features", "focus_sport", "risk_level", "bankroll_tip"],
            additionalProperties: false,
          },
        },
        maxTokens: 400,
      });
      recommendations = aiResult.output;
    } catch (e) {
      if (!(e instanceof AIProviderError)) console.error("AI API error:", e);
      recommendations = {
        welcome_message: "Welcome to Sentinel! Let's find your edge.",
        daily_tip: "Track closing line movement on player props — if a line shifts toward your pick before tip-off, it confirms sharp money agrees with your read.",
        recommended_features: ["props", "free-picks", "tracker"],
        focus_sport: sports?.[0] || "NBA",
        risk_level: "medium",
        bankroll_tip: "Never bet more than 3% of your bankroll on a single play.",
      };
    }

    return new Response(JSON.stringify({ recommendations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
