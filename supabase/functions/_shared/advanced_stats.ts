// ─────────────────────────────────────────────────────────────
// Shared Advanced Stats — xG proxy, Corsi proxy, pace
// Reusable across NHL/NBA/MLB models. NHL wires it first.
// All scorers return 0-100 where 50 = league neutral.
// ─────────────────────────────────────────────────────────────

export interface XGResult {
  xG60: number;
  sample: number;
  fallback: boolean;
}

export interface CFResult {
  cfPct: number;
  sample: number;
  fallback: boolean;
}

const NHL_XG_BASELINE = 2.7;       // xG/60 league avg
const NHL_CF_BASELINE = 50.0;      // Corsi For % neutral
const NHL_PACE_BASELINE = 60.0;    // combined SAT/60

// ── xG proxy ─────────────────────────────────────────────────
// Try shot-location bucket weighting; fall back to SOG × SH% × 0.95.
export function computeXGProxy(events: any[], teamId: string): XGResult {
  const completed = (events || [])
    .filter((e) => {
      const st = e.competitions?.[0]?.status?.type;
      return st?.completed === true || st?.name === "STATUS_FINAL";
    })
    .slice(-10);

  let xgSum = 0;
  let minutes = 0;
  let usedFallback = false;
  let sample = 0;

  for (const ev of completed) {
    const comp = ev.competitions?.[0];
    const tc = comp?.competitors?.find(
      (c: any) => String(c.team?.id || c.id) === String(teamId),
    );
    if (!tc) continue;

    // Best-effort high/medium/low danger from competitor.statistics
    const statsArr = tc.statistics || [];
    const findStat = (k: string) => {
      const s = statsArr.find((x: any) =>
        (x.name || "").toLowerCase().includes(k.toLowerCase()),
      );
      return s ? parseFloat(s.displayValue || s.value || "0") || 0 : 0;
    };

    const sog = findStat("shotsOnGoal") || findStat("shots") || 0;
    const high = findStat("highDanger");
    const med = findStat("mediumDanger");
    const low = findStat("lowDanger");

    let gameXG = 0;
    if (high + med + low > 0) {
      gameXG = high * 0.22 + med * 0.10 + low * 0.04; // bucket xG conversions
    } else if (sog > 0) {
      // Fallback: SOG × shooting%-proxy × 0.95
      const goals = parseInt(tc.score || "0", 10);
      const shPct = sog > 0 ? (goals / sog) * 100 : 9.5;
      gameXG = sog * (shPct / 100) * 0.95;
      usedFallback = true;
    }
    xgSum += gameXG;
    minutes += 60;
    sample++;
  }

  const xG60 = minutes > 0 ? (xgSum / minutes) * 60 : NHL_XG_BASELINE;
  return { xG60, sample, fallback: usedFallback };
}

export function scoreXG(xG60: number): number {
  const diff = xG60 - NHL_XG_BASELINE;
  return Math.max(0, Math.min(100, 50 + diff * 18));
}

// ── Corsi For % proxy ───────────────────────────────────────
export function computeCFProxy(events: any[], teamId: string): CFResult {
  const completed = (events || [])
    .filter((e) => {
      const st = e.competitions?.[0]?.status?.type;
      return st?.completed === true || st?.name === "STATUS_FINAL";
    })
    .slice(-10);

  let satFor = 0;
  let satTotal = 0;
  let usedFallback = false;
  let sample = 0;

  for (const ev of completed) {
    const comp = ev.competitions?.[0];
    const tc = comp?.competitors?.find(
      (c: any) => String(c.team?.id || c.id) === String(teamId),
    );
    const oc = comp?.competitors?.find(
      (c: any) => String(c.team?.id || c.id) !== String(teamId),
    );
    if (!tc || !oc) continue;

    const get = (c: any, key: string) => {
      const s = (c.statistics || []).find((x: any) =>
        (x.name || "").toLowerCase().includes(key.toLowerCase()),
      );
      return s ? parseFloat(s.displayValue || s.value || "0") || 0 : 0;
    };

    const sogF = get(tc, "shotsOnGoal") || get(tc, "shots");
    const blkF = get(tc, "blocked");
    const misF = get(tc, "missed");
    const sogA = get(oc, "shotsOnGoal") || get(oc, "shots");
    const blkA = get(oc, "blocked");
    const misA = get(oc, "missed");

    let satF = sogF + blkF + misF;
    let satA = sogA + blkA + misA;
    if (blkF + misF + blkA + misA === 0 && (sogF || sogA)) {
      // Fallback: pure SOG differential
      satF = sogF;
      satA = sogA;
      usedFallback = true;
    }
    satFor += satF;
    satTotal += satF + satA;
    sample++;
  }

  const cfPct = satTotal > 0 ? (satFor / satTotal) * 100 : NHL_CF_BASELINE;
  return { cfPct, sample, fallback: usedFallback };
}

export function scoreCFProxy(cfPct: number): number {
  const diff = cfPct - NHL_CF_BASELINE;
  return Math.max(0, Math.min(100, 50 + diff * 4));
}

// ── Pace (combined SAT/60) ─────────────────────────────────
export function computePace(eventsA: any[], teamIdA: string, eventsB: any[], teamIdB: string): number {
  const cfA = computeCFProxy(eventsA, teamIdA);
  const cfB = computeCFProxy(eventsB, teamIdB);
  // SAT/60 ≈ (cfPct over 50%) calibrated; here we just average implied attempt rates from sample sizes
  // Simpler approach: average shots+blocked+missed totals seen
  const avgA = cfA.sample > 0 ? estimateSATper60(eventsA, teamIdA) : NHL_PACE_BASELINE / 2;
  const avgB = cfB.sample > 0 ? estimateSATper60(eventsB, teamIdB) : NHL_PACE_BASELINE / 2;
  return avgA + avgB;
}

function estimateSATper60(events: any[], teamId: string): number {
  const completed = (events || [])
    .filter((e) => {
      const st = e.competitions?.[0]?.status?.type;
      return st?.completed === true || st?.name === "STATUS_FINAL";
    })
    .slice(-10);
  if (completed.length === 0) return NHL_PACE_BASELINE / 2;
  let sat = 0;
  for (const ev of completed) {
    const comp = ev.competitions?.[0];
    const tc = comp?.competitors?.find(
      (c: any) => String(c.team?.id || c.id) === String(teamId),
    );
    if (!tc) continue;
    const get = (key: string) => {
      const s = (tc.statistics || []).find((x: any) =>
        (x.name || "").toLowerCase().includes(key.toLowerCase()),
      );
      return s ? parseFloat(s.displayValue || s.value || "0") || 0 : 0;
    };
    sat += (get("shotsOnGoal") || get("shots")) + get("blocked") + get("missed");
  }
  return sat / completed.length; // per game ≈ per 60
}

export function scorePace(combinedSAT60: number): number {
  const diff = combinedSAT60 - NHL_PACE_BASELINE;
  return Math.max(0, Math.min(100, 50 + diff * 1.5));
}
