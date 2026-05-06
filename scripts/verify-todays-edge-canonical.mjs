#!/usr/bin/env node

const url = process.env.SUPABASE_URL || process.env.PROJECT_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

function normalizeConfidencePercent(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
}

function normalizeVerdict(verdict, confidence) {
  const v = String(verdict ?? "").trim().toUpperCase();
  if (v.includes("STRONG")) return "STRONG";
  if (v.includes("LEAN")) return "LEAN";
  if (v.includes("RISKY") || v.includes("SLIGHT") || v.includes("MARGINAL")) return "RISKY";
  if (v.includes("PASS") || v.includes("FADE") || v.includes("DO NOT BET") || v.includes("NO BET")) return "PASS";
  const c = normalizeConfidencePercent(confidence);
  if (c >= 72) return "STRONG";
  if (c >= 58) return "LEAN";
  if (c >= 42) return "RISKY";
  return "PASS";
}

function headers() {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

if (!url || !serviceKey) {
  console.log("[verify-todays-edge-canonical] skipped: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run live verification");
  process.exit(0);
}

const restBase = `${url.replace(/\/$/, "")}/rest/v1`;
const fnBase = `${url.replace(/\/$/, "")}/functions/v1`;
const today = new Date().toISOString().slice(0, 10);

const pickResp = await fetch(
  `${restBase}/daily_picks?select=*&sport=eq.nba&tier=eq.edge&pick_date=eq.${today}&order=confidence.desc.nullslast&limit=1`,
  { headers: headers() },
);

if (!pickResp.ok) {
  throw new Error(`daily_picks fetch failed ${pickResp.status}: ${await pickResp.text()}`);
}

const [pick] = await pickResp.json();

if (!pick) {
  console.log(`[verify-todays-edge-canonical] skipped: no NBA Today Edge row for ${today}`);
  process.exit(0);
}

for (const field of ["confidence", "hit_rate", "verdict", "tier"]) {
  if (pick[field] == null || pick[field] === "") {
    throw new Error(`daily_picks row ${pick.id ?? "<unknown>"} missing required field: ${field}`);
  }
}

const analyzeResp = await fetch(`${fnBase}/nba-api/analyze`, {
  method: "POST",
  headers: headers(),
  body: JSON.stringify({
    player: pick.player_name,
    prop_type: pick.prop_type,
    line: Number(pick.line),
    over_under: pick.direction,
    opponent: pick.opponent || undefined,
    sport: "nba",
  }),
});

if (!analyzeResp.ok) {
  throw new Error(`nba-api/analyze failed ${analyzeResp.status}: ${await analyzeResp.text()}`);
}

const analyzed = await analyzeResp.json();
const storedConfidence = Math.round(normalizeConfidencePercent(pick.confidence ?? pick.hit_rate));
const analyzerConfidence = Math.round(
  normalizeConfidencePercent(analyzed.canonical_confidence ?? analyzed.confidence ?? analyzed.displayConfidence),
);
const storedVerdict = normalizeVerdict(pick.verdict, storedConfidence);
const analyzerVerdict = normalizeVerdict(
  analyzed.canonical_verdict ?? analyzed.verdict ?? analyzed.decision?.verdict,
  analyzerConfidence,
);

if (storedVerdict !== analyzerVerdict) {
  throw new Error(
    `verdict mismatch for ${pick.player_name} ${pick.direction} ${pick.line} ${pick.prop_type}: stored=${storedVerdict}, analyzer=${analyzerVerdict}`,
  );
}

const diff = Math.abs(storedConfidence - analyzerConfidence);
if (diff > 1) {
  throw new Error(
    `confidence mismatch for ${pick.player_name} ${pick.direction} ${pick.line} ${pick.prop_type}: stored=${storedConfidence}, analyzer=${analyzerConfidence}, diff=${diff}`,
  );
}

console.log(
  `[verify-todays-edge-canonical] ok: ${pick.player_name} ${pick.direction} ${pick.line} ${pick.prop_type} ${storedConfidence}% ${storedVerdict}`,
);
