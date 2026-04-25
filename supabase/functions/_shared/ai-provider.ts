// Shared AI provider with cascading fallback:
// Gemini 2.0 Flash Lite → Grok fast-reasoning → Grok mini → OpenAI (optional)

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

export interface AICallOptions {
  fnName: string;
  messages: AIMessage[];
  tool?: AITool;
  maxTokens?: number;
  temperature?: number;
}

export interface AICallResult {
  output: string | Record<string, unknown>;
  provider: "gemini" | "grok-fast" | "grok-mini" | "openai";
  model: string;
}

export class AIProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIProviderError";
  }
}

const GEMINI_MODEL = "gemini-2.0-flash-lite";
const GROK_FAST_MODEL = "grok-4-1-fast-reasoning";
const GROK_MINI_MODEL = "grok-3-mini";
const OPENAI_MODEL = "gpt-4o-mini";
const GROK_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

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
  providerLabel: "grok-fast" | "grok-mini" | "openai",
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
  const { fnName, messages, tool, maxTokens = 600, temperature = 0.3 } = opts;

  // 1. Gemini
  try {
    const output = await tryGemini(fnName, messages, tool, maxTokens, temperature);
    return { output, provider: "gemini", model: GEMINI_MODEL };
  } catch { /* fall through */ }

  // 2 & 3. Grok (fast-reasoning, then mini — same key)
  const grokKey = Deno.env.get("GROK_API_KEY");
  if (grokKey) {
    try {
      const output = await tryOpenAICompat(fnName, "grok-fast", GROK_ENDPOINT, grokKey, GROK_FAST_MODEL, "grok-mini", messages, tool, maxTokens, temperature);
      return { output, provider: "grok-fast", model: GROK_FAST_MODEL };
    } catch { /* fall through */ }

    try {
      const output = await tryOpenAICompat(fnName, "grok-mini", GROK_ENDPOINT, grokKey, GROK_MINI_MODEL, "openai", messages, tool, maxTokens, temperature);
      return { output, provider: "grok-mini", model: GROK_MINI_MODEL };
    } catch { /* fall through */ }
  } else {
    console.log(`[ai-provider] fn=${fnName} GROK_API_KEY not set — skipping grok`);
  }

  // 4. OpenAI (optional)
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
