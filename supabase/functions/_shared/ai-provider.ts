// Shared AI provider with cascading fallback.
//
// Primary path is Grok with three tiers selected by the caller via the
// optional `tier` field on AICallOptions:
//   - "normal" (default) → ANALYZER_MODEL  (grok-4.3)
//   - "cheap"            → FALLBACK_MODEL  (grok-4.20-0309-non-reasoning)
//   - "heavy"            → HEAVY_REASONING_MODEL  (grok-4.20-0309-reasoning)
//
// Each tier cascades down on failure to the next-lighter Grok model, then
// hits Gemini (if GEMINI_API_KEY has quota) and finally OpenAI (if set) as
// last-resort backstops so "Analysis currently unavailable" only shows when
// every provider is actually down.

export const ANTI_GENERIC_INSTRUCTION =
  `You must generate unique, context-aware analysis. Do NOT reuse generic templates or repeated phrasing. Tailor analysis specifically to the provided player, matchup, stats, and context passed in this prompt. Reference the actual data provided. Vary sentence structure across responses. Avoid phrases like "this is a strong play" unless justified by specific data points. Each output must feel specific to this exact query and not be reusable for any other query.`;

export const PERSONALIZATION_INSTRUCTION =
  `Incorporate the user-specific context provided. Adjust tone and recommendations based on their sports, style, and input data. Never return a static or repeated response.`;

export interface AIMessage {
  role: "system" | "user";
  content: string;
}

export interface AITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AITier = "normal" | "cheap" | "heavy";

export interface AICallOptions {
  fnName: string;
  messages: AIMessage[];
  tool?: AITool;
  maxTokens?: number;
  temperature?: number;
  /**
   * Routing tier. Defaults to "normal" (grok-4.3).
   * - "cheap"  → start at the non-reasoning fallback; for low-stakes UX copy
   *              (e.g. prop-explainer, rotating-tip).
   * - "heavy"  → start at the reasoning model; for hard/conflicting picks
   *              where the analyzer disagrees with deterministic scoring.
   */
  tier?: AITier;
}

export interface AICallResult {
  output: string | Record<string, unknown>;
  provider: "grok" | "gemini" | "openai";
  model: string;
}

export class AIProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIProviderError";
  }
}

const GEMINI_MODEL = "gemini-2.0-flash-lite";
const OPENAI_MODEL = "gpt-4o-mini";
const GROK_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Grok models are env-driven so they can be rotated without redeploying.
// Defaults match the production xAI team entitlements as of 2026-05.
const ANALYZER_MODEL_DEFAULT = "grok-4.3";
const FALLBACK_MODEL_DEFAULT = "grok-4.20-0309-non-reasoning";
const HEAVY_REASONING_MODEL_DEFAULT = "grok-4.20-0309-reasoning";

function grokModelsForTier(tier: AITier): string[] {
  const analyzer = Deno.env.get("ANALYZER_MODEL") ?? ANALYZER_MODEL_DEFAULT;
  const fallback = Deno.env.get("FALLBACK_MODEL") ?? FALLBACK_MODEL_DEFAULT;
  const heavy = Deno.env.get("HEAVY_REASONING_MODEL") ?? HEAVY_REASONING_MODEL_DEFAULT;
  // Each tier degrades to lighter models on failure rather than escalating —
  // a heavy-tier failure most often means rate-limit, so retrying lighter is
  // both cheaper and faster.
  if (tier === "heavy") return [heavy, analyzer, fallback];
  if (tier === "cheap") return [fallback];
  return [analyzer, fallback];
}

// Gemini doesn't accept additionalProperties — strip it recursively
function stripAdditionalProps(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return schema;
  const obj = schema as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { additionalProperties: _drop, ...rest } = obj;
  if (rest.properties && typeof rest.properties === "object") {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties as Record<string, unknown>).map(([k, v]) => [k, stripAdditionalProps(v)])
    );
  }
  if (rest.items) rest.items = stripAdditionalProps(rest.items);
  return rest;
}

async function tryGemini(
  fnName: string,
  messages: AIMessage[],
  tool: AITool | undefined,
  maxTokens: number,
  temperature: number,
): Promise<string | Record<string, unknown>> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.log(`[ai-provider] fn=${fnName} GEMINI_API_KEY not set — skipping gemini`);
    throw new Error("GEMINI_API_KEY not set");
  }

  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role === "user");

  const body: Record<string, unknown> = {
    contents: userMsgs.map(m => ({ role: "user", parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (systemMsg) body.system_instruction = { parts: [{ text: systemMsg.content }] };
  if (tool) {
    body.tools = [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: stripAdditionalProps(tool.parameters) }] }];
    body.tool_config = { function_calling_config: { mode: "ANY", allowed_function_names: [tool.name] } };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  console.log(`[ai-provider] fn=${fnName} trying provider=gemini model=${GEMINI_MODEL}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.log(`[ai-provider] fn=${fnName} provider=gemini FAILED status=${resp.status} reason=${errText.slice(0, 200)} → trying grok-fast`);
    throw new Error(`gemini ${resp.status}`);
  }

  const data = await resp.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];

  if (tool) {
    if (!part?.functionCall?.args) {
      console.log(`[ai-provider] fn=${fnName} provider=gemini FAILED reason=no_function_call → trying grok-fast`);
      throw new Error("gemini no function call");
    }
    console.log(`[ai-provider] fn=${fnName} provider=gemini SUCCESS model=${GEMINI_MODEL}`);
    return part.functionCall.args as Record<string, unknown>;
  }

  const text: string = part?.text ?? "";
  if (!text) {
    console.log(`[ai-provider] fn=${fnName} provider=gemini FAILED reason=empty_response → trying grok-fast`);
    throw new Error("gemini empty response");
  }
  console.log(`[ai-provider] fn=${fnName} provider=gemini SUCCESS model=${GEMINI_MODEL}`);
  return text;
}

async function tryOpenAICompat(
  fnName: string,
  providerLabel: "grok" | "openai",
  endpoint: string,
  apiKey: string,
  model: string,
  nextLabel: string,
  messages: AIMessage[],
  tool: AITool | undefined,
  maxTokens: number,
  temperature: number,
): Promise<string | Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    temperature,
  };
  if (tool) {
    body.tools = [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }];
    body.tool_choice = { type: "function", function: { name: tool.name } };
  }

  console.log(`[ai-provider] fn=${fnName} trying provider=${providerLabel} model=${model}`);

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.log(`[ai-provider] fn=${fnName} provider=${providerLabel} FAILED status=${resp.status} reason=${errText.slice(0, 200)} → trying ${nextLabel}`);
    throw new Error(`${providerLabel} ${resp.status}`);
  }

  const data = await resp.json();

  if (tool) {
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      console.log(`[ai-provider] fn=${fnName} provider=${providerLabel} FAILED reason=no_tool_call → trying ${nextLabel}`);
      throw new Error(`${providerLabel} no tool call`);
    }
    console.log(`[ai-provider] fn=${fnName} provider=${providerLabel} SUCCESS model=${model}`);
    return JSON.parse(args) as Record<string, unknown>;
  }

  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text) {
    console.log(`[ai-provider] fn=${fnName} provider=${providerLabel} FAILED reason=empty_response → trying ${nextLabel}`);
    throw new Error(`${providerLabel} empty response`);
  }
  console.log(`[ai-provider] fn=${fnName} provider=${providerLabel} SUCCESS model=${model}`);
  return text;
}

export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const { fnName, messages, tool, maxTokens = 600, temperature = 0.3, tier = "normal" } = opts;

  // 1. Grok (primary) — three configurable models per tier.
  const grokKey = Deno.env.get("GROK_API_KEY");
  if (grokKey) {
    const models = grokModelsForTier(tier);
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const next = i + 1 < models.length ? models[i + 1] : "gemini";
      try {
        const output = await tryOpenAICompat(
          fnName, "grok", GROK_ENDPOINT, grokKey, model, next,
          messages, tool, maxTokens, temperature,
        );
        return { output, provider: "grok", model };
      } catch { /* try next model */ }
    }
  } else {
    console.log(`[ai-provider] fn=${fnName} GROK_API_KEY not set — skipping grok`);
  }

  // 2. Gemini backstop — only used if every Grok model failed.
  try {
    const output = await tryGemini(fnName, messages, tool, maxTokens, temperature);
    return { output, provider: "gemini", model: GEMINI_MODEL };
  } catch { /* fall through */ }

  // 3. OpenAI last-resort.
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey) {
    try {
      const output = await tryOpenAICompat(fnName, "openai", OPENAI_ENDPOINT, openaiKey, OPENAI_MODEL, "none", messages, tool, maxTokens, temperature);
      return { output, provider: "openai", model: OPENAI_MODEL };
    } catch { /* fall through */ }
  } else {
    console.log(`[ai-provider] fn=${fnName} OPENAI_API_KEY not set — skipping openai`);
  }

  console.log(`[ai-provider] fn=${fnName} ALL providers FAILED — throwing AIProviderError`);
  throw new AIProviderError("all_providers_failed");
}
