import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp",
};

const ESPN_UFC_BASE = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc";

// ── Snapshot logging — fire and forget ──
async function logSnapshot(payload: Record<string, any>): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("logSnapshot: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return;
    }
    const r = await fetch(`${supabaseUrl}/rest/v1/prediction_snapshots`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error(`logSnapshot insert failed ${r.status}:`, text);
    }
  } catch (e) {
    console.error("logSnapshot failed:", (e as Error).message);
  }
}

// ── ESPN Search ─────────────────────────────────────────────
async function searchFighters(query: string) {
  const results: any[] = [];
  const qLower = query.toLowerCase();

  try {
    const resp = await fetch(
      `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(query)}&limit=25&mode=prefix&type=player&sport=mma`
    );
    const data = await resp.json();
    for (const item of data?.items || data?.results || []) {
      const athlete = item?.athlete || item;
      const name = athlete?.displayName || athlete?.fullName || item?.displayName || item?.name || "";
      if (name.toLowerCase().includes(qLower)) {
        const id = athlete?.id || item?.id || item?.uid?.split(":")?.[3];
        const headshot = athlete?.headshot?.href || athlete?.headshot || item?.headshot?.href || "";
        if (id) results.push({ id: String(id), name, record: athlete?.record || item?.record || "", headshot });
      }
    }
  } catch (e) {
    console.error("ESPN search error:", e);
  }

  if (results.length === 0) {
    try {
      const sbResp = await fetch(`${ESPN_UFC_BASE}/scoreboard`);
      const sbData = await sbResp.json();
      for (const event of sbData?.events || []) {
        for (const comp of event?.competitions || []) {
          for (const c of comp?.competitors || []) {
            const a = c.athlete || c;
            if (a?.displayName?.toLowerCase().includes(qLower)) {
              results.push({ id: String(a.id), name: a.displayName, record: a.record?.summary || "", headshot: a?.headshot?.href || "" });
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  const unique = [...new Map(results.filter(r => r.name).map(r => [r.id, r])).values()].slice(0, 10);

  // Fetch headshots for results that don't have one
  const enriched = await Promise.all(unique.map(async (r) => {
    if (!r.headshot && r.id) {
      try {
        const aResp = await fetch(`${ESPN_CORE}/athletes/${r.id}`);
        const aData = await aResp.json();
        r.headshot = aData?.headshot?.href || "";
      } catch { /* ignore */ }
    }
    return r;
  }));

  return enriched;
}

// ── UFCStats.com Scraping ───────────────────────────────────
interface UFCStatsData {
  slpm: number;
  sapm: number;
  str_acc: string;
  str_def: string;
  td_avg: number;
  td_acc: string;
  td_def: string;
  sub_avg: number;
  fights: Array<{
    result: string;
    opponent: string;
    kd: number;
    str: number;
    td: number;
    sub: number;
    event: string;
    date: string;
    method: string;
    round: number;
    time: string;
  }>;
}

async function scrapeUFCStats(fighterName: string): Promise<UFCStatsData | null> {
  try {
    // Step 1: Find fighter on UFCStats by searching the alphabetical listing
    const lastName = fighterName.split(" ").pop()?.toLowerCase() || "";
    const firstChar = lastName.charAt(0);
    
    const listResp = await fetch(`http://ufcstats.com/statistics/fighters?char=${firstChar}&page=all`);
    const listHtml = await listResp.text();
    
    // Find fighter URL from the list page
    const nameLower = fighterName.toLowerCase();
    const nameVariants = [
      nameLower,
      nameLower.replace(/['']/g, ""),
    ];
    
    // Extract all fighter links and names from the HTML table
    const linkRegex = /href="(http:\/\/ufcstats\.com\/fighter-details\/[a-f0-9]+)"/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(listHtml)) !== null) {
      if (!links.includes(match[1])) links.push(match[1]);
    }

    // Parse the table rows to find our fighter
    // The table has columns: First, Last, Nickname, Ht., Wt., Reach, Stance, W, L, D, Belt
    // Each fighter appears multiple times (first name link, last name link, nickname link)
    let fighterUrl = "";
    
    // Try matching by looking for the fighter's full name in the HTML near a link
    const nameParts = fighterName.split(" ");
    const firstName = nameParts[0]?.toLowerCase() || "";
    const lastNamePart = nameParts.slice(1).join(" ").toLowerCase();
    
    // Parse table rows
    const rowRegex = /<tr[^>]*class="b-statistics__table-row"[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(listHtml)) !== null) {
      const row = rowMatch[1];
      const cellTexts: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(row)) !== null) {
        // Strip HTML tags from cell content
        const text = cellMatch[1].replace(/<[^>]+>/g, "").trim();
        cellTexts.push(text);
      }
      
      // cellTexts[0] = First name, cellTexts[1] = Last name
      if (cellTexts.length >= 2) {
        const rowFirst = cellTexts[0].toLowerCase().trim();
        const rowLast = cellTexts[1].toLowerCase().trim();
        const rowFull = `${rowFirst} ${rowLast}`.trim();
        
        if (nameVariants.some(v => rowFull.includes(v) || v.includes(rowFull)) ||
            (rowFirst.includes(firstName) && rowLast.includes(lastNamePart)) ||
            (firstName.includes(rowFirst) && lastNamePart.includes(rowLast))) {
          // Extract the link from this row
          const linkMatch = row.match(/href="(http:\/\/ufcstats\.com\/fighter-details\/[a-f0-9]+)"/);
          if (linkMatch) {
            fighterUrl = linkMatch[1];
            break;
          }
        }
      }
    }
    
    if (!fighterUrl) {
      console.log(`UFCStats: Could not find fighter URL for "${fighterName}"`);
      return null;
    }

    console.log(`UFCStats: Found ${fighterName} at ${fighterUrl}`);

    // Step 2: Fetch the fighter detail page
    const detailResp = await fetch(fighterUrl);
    const detailHtml = await detailResp.text();

    // Parse career statistics
    const extractStat = (label: string): string => {
      // Look for pattern like: SLpM:</i>\s*<i ...>2.45</i>
      const patterns = [
        new RegExp(`${label}[:\\s]*<\\/i>\\s*(?:<\\/li>)?\\s*<li[^>]*>\\s*<i[^>]*>([^<]+)<\\/i>`, "i"),
        new RegExp(`${label}[:\\s]*</i>\\s*<i[^>]*>([^<]+)`, "i"),
        new RegExp(`${label}.*?([\\d.]+%?)`, "i"),
      ];
      for (const re of patterns) {
        const m = detailHtml.match(re);
        if (m) return m[1].trim();
      }
      return "0";
    };

    // More robust stat extraction - UFCStats uses a specific HTML structure
    const getStatValue = (statName: string): string => {
      // Pattern: <i class="b-list__box-item-title ...">SLpM:</i>\n<something>value</something>
      const re = new RegExp(
        `<i[^>]*>\\s*${statName}[:\\s]*<\\/i>\\s*(?:<\\/li>\\s*<li[^>]*>)?\\s*(?:<i[^>]*>)?\\s*([\\d.]+%?)`,
        "i"
      );
      const m = detailHtml.match(re);
      return m ? m[1].trim() : "0";
    };

    const slpm = parseFloat(getStatValue("SLpM")) || 0;
    const sapm = parseFloat(getStatValue("SApM")) || 0;
    const strAcc = getStatValue("Str\\. Acc\\.") || getStatValue("Str\\.\\s*Acc") || "0%";
    const strDef = getStatValue("Str\\. Def") || getStatValue("Str\\.\\s*Def") || "0%";
    const tdAvg = parseFloat(getStatValue("TD Avg\\.") || getStatValue("TD\\s*Avg")) || 0;
    const tdAcc = getStatValue("TD Acc\\.") || getStatValue("TD\\s*Acc") || "0%";
    const tdDef = getStatValue("TD Def\\.") || getStatValue("TD\\s*Def") || "0%";
    const subAvg = parseFloat(getStatValue("Sub\\. Avg\\.") || getStatValue("Sub\\.\\s*Avg")) || 0;

    console.log(`UFCStats parsed: SLpM=${slpm}, SApM=${sapm}, StrAcc=${strAcc}, TDAvg=${tdAvg}`);

    // Parse fight history from the table
    const fights: UFCStatsData["fights"] = [];
    // The fight table rows contain: W/L, Fighter names, Kd, Str, Td, Sub, Event+Date, Method, Round, Time
    const fightRowRegex = /<tr[^>]*class="b-fight-details__table-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let fightMatch;
    while ((fightMatch = fightRowRegex.exec(detailHtml)) !== null) {
      const row = fightMatch[1];
      // Extract cells
      const cells: string[] = [];
      const cRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cMatch;
      while ((cMatch = cRegex.exec(row)) !== null) {
        cells.push(cMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      }
      
      if (cells.length >= 10) {
        const wl = cells[0].toLowerCase().includes("win") ? "W" : cells[0].toLowerCase().includes("loss") ? "L" : "D";
        // Fighter cell contains both names, extract opponent (second name)
        const names = cells[1].split(/\s{2,}/).filter(n => n.trim());
        const opponent = names.length > 1 ? names[1].trim() : names[0]?.trim() || "";
        
        // Parse numeric stats (they appear as "X Y" for fighter and opponent)
        const parseFirstNum = (s: string) => parseInt(s.split(/\s+/)[0]) || 0;
        
        fights.push({
          result: wl,
          opponent,
          kd: parseFirstNum(cells[2]),
          str: parseFirstNum(cells[3]),
          td: parseFirstNum(cells[4]),
          sub: parseFirstNum(cells[5]),
          event: cells[6]?.trim() || "",
          method: cells[7]?.trim() || "",
          round: parseInt(cells[8]) || 0,
          time: cells[9]?.trim() || "",
          date: "", // extracted from event cell
        });
      }
    }

    return { slpm, sapm, str_acc: strAcc, str_def: strDef, td_avg: tdAvg, td_acc: tdAcc, td_def: tdDef, sub_avg: subAvg, fights };
  } catch (e) {
    console.error("UFCStats scrape error:", e);
    return null;
  }
}

// ── Get Fighter Data (ESPN + UFCStats) ──────────────────────
interface FighterData {
  fighter: any;
  stats: any;
  recent_fights: any[];
  strikesPerMin: number;
  strikesAbsorbedPerMin: number;
  takedownAvg: number;
  avgFightRounds: number;
  finishRate: number;
  koRate: number;
  subRate: number;
  wins: number;
  losses: number;
  winStreak: number;
  age: number | null;
  reachInches: number | null;
  totalUfcFights: number;
  daysSinceLastFight: number | null;
  avgOpponentWinRate: number | null;
  hasRealStats: boolean;
}

async function getFighterData(name: string): Promise<FighterData | { error: string }> {
  let fighters = await searchFighters(name);

  if (!fighters.length) {
    try {
      const resp = await fetch(
        `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=player`
      );
      const data = await resp.json();
      const nameLower = name.toLowerCase();
      for (const item of data?.items || data?.results || []) {
        const a = item?.athlete || item;
        const dName = a?.displayName || a?.fullName || item?.displayName || "";
        if (dName.toLowerCase().includes(nameLower) || nameLower.includes(dName.toLowerCase())) {
          fighters.push({ id: String(a?.id || item?.id), name: dName, record: "" });
        }
      }
    } catch { /* ignore */ }
  }

  if (!fighters.length) return { error: `Fighter '${name}' not found. Try using their full name.` };

  const fighterId = fighters[0].id;
  const fighterDisplayName = fighters[0].name;

  try {
    // Fetch ESPN data and UFCStats data in parallel
    const [athleteResp, recordsResp, eventLogResp, ufcStatsData] = await Promise.all([
      fetch(`${ESPN_CORE}/athletes/${fighterId}`),
      fetch(`${ESPN_CORE}/athletes/${fighterId}/records`),
      fetch(`https://sports.core.api.espn.com/v2/sports/mma/athletes/${fighterId}/eventlog`),
      scrapeUFCStats(fighterDisplayName),
    ]);

    const athlete = await athleteResp.json();
    const recordsData = await recordsResp.json();
    const eventLogData = await eventLogResp.json();

    // Parse records from ESPN
    const overallRecord = recordsData?.items?.[0];
    const record = overallRecord?.summary || fighters[0].record || "0-0-0";
    const recordStats: Record<string, number> = {};
    for (const stat of overallRecord?.stats || []) {
      recordStats[stat.name] = stat.value || 0;
    }

    const wins = recordStats["wins"] || 0;
    const losses = recordStats["losses"] || 0;
    const koWins = recordStats["tkos"] || 0;
    const subWins = recordStats["submissions"] || 0;
    const decWins = Math.max(wins - koWins - subWins, 0);
    const finishRate = wins > 0 ? Math.round(((koWins + subWins) / wins) * 100) : 0;
    const koRate = wins > 0 ? Math.round((koWins / wins) * 100) : 0;
    const subRate = wins > 0 ? Math.round((subWins / wins) * 100) : 0;

    // Fetch recent fights from ESPN event log
    const eventItems = eventLogData?.events?.items || [];
    const recentFights: any[] = [];

    const fightFetches = eventItems.slice(0, 8).map(async (item: any) => {
      try {
        const compRef = item?.competition?.$ref;
        if (!compRef) return null;

        const compResp = await fetch(compRef.replace("http://", "https://"));
        const comp = await compResp.json();

        // Skip future/upcoming fights
        if (comp?.date && new Date(comp.date) > new Date()) return null;

        let opponent = "";
        let isWinner = false;
        for (const c of comp?.competitors || []) {
          if (String(c.id) === String(fighterId)) {
            isWinner = c.winner === true || c.winner === "true" || c.outcome?.type === "win";
          } else {
            const oppRef = c?.athlete?.$ref;
            if (oppRef) {
              try {
                const oppResp = await fetch(oppRef.replace("http://", "https://"));
                const oppData = await oppResp.json();
                opponent = oppData?.displayName || oppData?.fullName || "Unknown";
              } catch { opponent = `Fighter #${c.id}`; }
            }
          }
        }

        let method = "";
        let round = "";
        let roundNum = 0;

        if (comp?.status?.$ref) {
          try {
            const statusResp = await fetch(comp.status.$ref.replace("http://", "https://"));
            const status = await statusResp.json();
            method = status?.result?.shortDisplayName || status?.result?.name || "";
            round = status?.result?.description || "";
            const roundMatch = round.match(/(\d+)/);
            roundNum = roundMatch ? parseInt(roundMatch[1]) : 0;
            if (!roundNum && status?.period) roundNum = status.period;
          } catch { /* ignore */ }
        }

        // Skip unfinished fights (no round, no method)
        if (roundNum === 0 && !method) return null;

        return {
          date: comp?.date ? new Date(comp.date).toLocaleDateString() : "N/A",
          opponent, result: isWinner ? "W" : "L", method,
          round: round || `R${roundNum}`, roundNum,
        };
      } catch { return null; }
    });

    const fightResults = await Promise.all(fightFetches);
    for (const f of fightResults) { if (f) recentFights.push(f); }

    const roundNums = recentFights.filter(f => f.roundNum > 0).map(f => f.roundNum);
    const avgFightRounds = roundNums.length > 0 ? roundNums.reduce((a, b) => a + b, 0) / roundNums.length : 2.5;

    // Calculate win streak
    let winStreak = 0;
    for (const f of recentFights) {
      if (f.result === "W") winStreak++;
      else break;
    }

    // Calculate age
    let age: number | null = null;
    if (athlete?.dateOfBirth) {
      const dob = new Date(athlete.dateOfBirth);
      const now = new Date();
      age = Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    } else if (athlete?.age) {
      age = athlete.age;
    }

    // Parse reach in inches from ESPN (e.g. "76\"" or "76 in" or just number)
    let reachInches: number | null = null;
    const reachStr = athlete?.displayReach || athlete?.reach || "";
    if (reachStr) {
      const reachMatch = String(reachStr).match(/(\d+)/);
      if (reachMatch) reachInches = parseInt(reachMatch[1]);
    }

    // Total UFC fights = number of event log entries we found
    const totalUfcFights = recentFights.length;

    // Days since last fight (ring rust)
    let daysSinceLastFight: number | null = null;
    if (recentFights.length > 0 && recentFights[0].date && recentFights[0].date !== "N/A") {
      const lastDate = new Date(recentFights[0].date);
      if (!isNaN(lastDate.getTime())) {
        daysSinceLastFight = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    // Average opponent win rate (proxy for level of competition)
    // We estimate based on result ratios — if fighter beat many opponents, those opponents tended to be competitive
    // Better proxy: count how many of fighter's opponents were also winners
    // Filter out NCs and Draws for clean recent form
    const completedFights = recentFights.filter(f => f.result === "W" || f.result === "L");
    
    // Level of Competition: dynamic proxy based on opponent quality signals
    // Fighters who win most fights AND have long fight histories likely faced tougher competition
    // Fighters with high finish rates against experienced opponents score higher
    let avgOpponentWinRate: number | null = null;
    if (completedFights.length > 0) {
      const winRatio = completedFights.filter(f => f.result === "W").length / completedFights.length;
      const fightVolume = Math.min(completedFights.length / 8, 1); // normalize to 0-1 (8+ fights = max)
      // Combine win ratio with volume — beating many opponents is harder than beating few
      // Also factor in finish rate — finishing experienced fighters is a quality signal
      const finishQuality = (finishRate / 100) * 0.15;
      avgOpponentWinRate = 0.42 + (winRatio * 0.12) + (fightVolume * 0.06) + finishQuality;
      // Clamp to reasonable range
      avgOpponentWinRate = Math.min(0.62, Math.max(0.40, avgOpponentWinRate));
    }

    // Use REAL UFCStats data if available, otherwise estimate conservatively
    // IMPORTANT: Estimated stats are clamped to prevent inflation (e.g. Procházka getting 8.6 SLpM)
    const hasRealStats = !!ufcStatsData;
    let strikesPerMin = ufcStatsData?.slpm || (koWins > 0 ? Math.round((koWins / Math.max(wins + losses, 1)) * 8 * 10) / 10 + 2.5 : 3.0);
    let strikesAbsorbedPerMin = ufcStatsData?.sapm || 2.5;
    let takedownAvg = ufcStatsData?.td_avg || (subWins > 0 ? Math.round((subWins / Math.max(wins + losses, 1)) * 3 * 10) / 10 : 0.5);
    
    // Clamp estimated stats to reasonable ranges to prevent model inflation
    if (!hasRealStats) {
      strikesPerMin = Math.min(strikesPerMin, 5.5);       // cap estimated SLpM
      strikesAbsorbedPerMin = Math.max(strikesAbsorbedPerMin, 2.0); // floor estimated SApM
      takedownAvg = Math.min(takedownAvg, 3.0);            // cap estimated TD avg
      console.log(`WARNING: Using estimated stats for ${fighterDisplayName} — clamped to conservative ranges`);
    }

    // Determine weight class from ESPN or record
    let weightClass = athlete?.weightClass?.text || "";
    if (!weightClass || weightClass === "Unknown") {
      const weight = athlete?.weight || 0;
      if (weight <= 115) weightClass = "Strawweight";
      else if (weight <= 125) weightClass = "Flyweight";
      else if (weight <= 135) weightClass = "Bantamweight";
      else if (weight <= 145) weightClass = "Featherweight";
      else if (weight <= 155) weightClass = "Lightweight";
      else if (weight <= 170) weightClass = "Welterweight";
      else if (weight <= 185) weightClass = "Middleweight";
      else if (weight <= 205) weightClass = "Light Heavyweight";
      else weightClass = "Heavyweight";
    }

    return {
      fighter: {
        name: athlete?.displayName || fighterDisplayName,
        record, weight_class: weightClass,
        stance: athlete?.stance?.text || "Orthodox",
        image_url: athlete?.headshot?.href || "",
        height: athlete?.displayHeight || "",
        reach: athlete?.displayReach || "",
        age,
        win_streak: winStreak,
        weight: athlete?.displayWeight || "",
      },
      stats: {
        ko_wins: koWins, sub_wins: subWins, dec_wins: decWins, finish_rate: finishRate,
        strikes_per_min: strikesPerMin,
        strikes_absorbed_per_min: strikesAbsorbedPerMin,
        takedown_avg: takedownAvg,
        str_accuracy: ufcStatsData?.str_acc || null,
        str_defense: ufcStatsData?.str_def || null,
        td_accuracy: ufcStatsData?.td_acc || null,
        td_defense: ufcStatsData?.td_def || null,
        sub_avg: ufcStatsData?.sub_avg || null,
        data_source: hasRealStats ? "ufcstats" : "estimated",
      },
      recent_fights: recentFights,
      strikesPerMin, strikesAbsorbedPerMin, takedownAvg,
      avgFightRounds, finishRate, koRate, subRate, wins, losses,
      winStreak, age, reachInches, totalUfcFights, daysSinceLastFight, avgOpponentWinRate,
      hasRealStats,
    };
  } catch (e) {
    console.error("Fighter details error:", e);
    return { error: "Failed to fetch fighter details" };
  }
}

// ── Helpers ──────────────────────────────────────────────────
function parsePct(val: string | null | undefined, fallback = 50): number {
  if (!val) return fallback;
  return parseFloat(val.replace("%", "")) || fallback;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Classify a fighter's style based on stat ratios */
function classifyStyle(f: FighterData): "striker" | "grappler" | "balanced" {
  const tdWeight = f.takedownAvg + f.subRate / 25;
  const strikeWeight = f.strikesPerMin / 3 + f.koRate / 25;
  if (tdWeight > strikeWeight * 1.4) return "grappler";
  if (strikeWeight > tdWeight * 1.4) return "striker";
  return "balanced";
}

/** Weight class early-finish bias (positive = finishes earlier) */
function weightClassBias(wc: string): number {
  const w = (wc || "").toLowerCase();
  if (w.includes("heavyweight") && !w.includes("light")) return 0.14;
  if (w.includes("light heavyweight")) return 0.09;
  if (w.includes("middleweight")) return 0.04;
  if (w.includes("welterweight")) return 0;
  if (w.includes("lightweight")) return -0.02;
  if (w.includes("featherweight")) return -0.04;
  if (w.includes("bantamweight")) return -0.06;
  if (w.includes("flyweight") || w.includes("strawweight")) return -0.08;
  return 0;
}

/** Age factor: prime (26-32) → positive, decline (37+) → negative */
function ageFactor(age: number | null): number {
  if (!age) return 0;
  if (age <= 25) return 0.02;
  if (age <= 28) return 0.05;
  if (age <= 32) return 0.03;
  if (age <= 36) return 0;
  if (age <= 38) return -0.04;
  return -0.08;
}

// ── Matchup Analysis — 24-Factor Model ──────────────────────
function buildMatchupAnalysis(f1: FighterData, f2: FighterData) {
  // ── Pre-compute shared values ───────────────────────────────
  const f1Total = Math.max(f1.wins + f1.losses, 1);
  const f2Total = Math.max(f2.wins + f2.losses, 1);
  const f1WinRate = f1.wins / f1Total;                          // Factor 1
  const f2WinRate = f2.wins / f2Total;
  // Factor 2: Recent Form — only count clean W/L, skip NC/Draw
  const cleanRecent = (fights: any[]) => fights.slice(0, 5).filter(f => f.result === "W" || f.result === "L");
  const f1RecentClean = cleanRecent(f1.recent_fights);
  const f2RecentClean = cleanRecent(f2.recent_fights);
  const f1RecentWins = f1RecentClean.filter(f => f.result === "W").length;
  const f2RecentWins = f2RecentClean.filter(f => f.result === "W").length;

  const combinedAvgRounds = (f1.avgFightRounds + f2.avgFightRounds) / 2;
  const combinedFinishRate = (f1.finishRate + f2.finishRate) / 2;
  const combinedStrikesPerMin = f1.strikesPerMin + f2.strikesPerMin;

  // Round-by-round distribution
  const analyzeRoundFinishes = (fights: any[]) => {
    const completed = fights.filter(f => f.roundNum > 0);
    if (completed.length === 0) return { r1: 0, r2: 0, r3Plus: 0, total: 0, avgRound: 2.5 };
    const r1 = completed.filter(f => f.roundNum === 1).length;
    const r2 = completed.filter(f => f.roundNum === 2).length;
    const r3Plus = completed.filter(f => f.roundNum >= 3).length;
    const avgRound = completed.reduce((s, f) => s + f.roundNum, 0) / completed.length;
    return { r1, r2, r3Plus, total: completed.length, avgRound };
  };

  const f1Rounds = analyzeRoundFinishes(f1.recent_fights);
  const f2Rounds = analyzeRoundFinishes(f2.recent_fights);

  // Parse UFCStats percentages
  const f1StrAcc = parsePct(f1.stats?.str_accuracy) / 100;
  const f2StrAcc = parsePct(f2.stats?.str_accuracy) / 100;
  const f1StrDef = parsePct(f1.stats?.str_defense) / 100;
  const f2StrDef = parsePct(f2.stats?.str_defense) / 100;
  const f1TdDef  = parsePct(f1.stats?.td_defense) / 100;
  const f2TdDef  = parsePct(f2.stats?.td_defense) / 100;
  const f1SubAvg = f1.stats?.sub_avg ?? f1.takedownAvg * 0.3;
  const f2SubAvg = f2.stats?.sub_avg ?? f2.takedownAvg * 0.3;

  // Derived
  const f1StrikeDiff = f1.strikesPerMin - f1.strikesAbsorbedPerMin;
  const f2StrikeDiff = f2.strikesPerMin - f2.strikesAbsorbedPerMin;

  const f1Style = classifyStyle(f1);
  const f2Style = classifyStyle(f2);

  const wcBias = weightClassBias(f1.fighter?.weight_class || "");

  // Factor rates
  const f1R1Rate = f1Rounds.total > 0 ? f1Rounds.r1 / f1Rounds.total : 0.22;
  const f2R1Rate = f2Rounds.total > 0 ? f2Rounds.r1 / f2Rounds.total : 0.22;
  const f1Under2Rate = f1Rounds.total > 0 ? (f1Rounds.r1 + f1Rounds.r2) / f1Rounds.total : 0.38;
  const f2Under2Rate = f2Rounds.total > 0 ? (f2Rounds.r1 + f2Rounds.r2) / f2Rounds.total : 0.38;
  const f1GoesDistRate = f1Rounds.total > 0 ? f1Rounds.r3Plus / f1Rounds.total : 0.35;
  const f2GoesDistRate = f2Rounds.total > 0 ? f2Rounds.r3Plus / f2Rounds.total : 0.35;

  const f1FinishPct = f1.finishRate / 100;
  const f2FinishPct = f2.finishRate / 100;
  const f1KoPct    = f1.koRate / 100;
  const f2KoPct    = f2.koRate / 100;

  // ── New Factor data (21-24) ─────────────────────────────────
  // Factor 21: Reach Advantage (inches differential)
  const reachDiff = (f1.reachInches && f2.reachInches) ? f1.reachInches - f2.reachInches : 0;

  // Factor 22: Level of Competition (avg opponent quality)
  const f1OppQuality = f1.avgOpponentWinRate ?? 0.50;
  const f2OppQuality = f2.avgOpponentWinRate ?? 0.50;

  // Factor 23: Ring Rust — days since last fight
  // < 120 days = active (good), 120-300 = normal, 300-500 = rusty, 500+ = very rusty
  const ringRustScore = (days: number | null): number => {
    if (days === null) return 0;
    if (days <= 120) return 0.06;   // very active
    if (days <= 200) return 0.03;   // normal
    if (days <= 350) return 0;      // neutral
    if (days <= 500) return -0.04;  // rusty
    return -0.08;                   // very rusty
  };
  const f1RingRust = ringRustScore(f1.daysSinceLastFight);
  const f2RingRust = ringRustScore(f2.daysSinceLastFight);

  // Factor 24: UFC Experience (total UFC bouts)
  // More experience = better octagon IQ, handles pressure
  const expScore = (fights: number): number => {
    if (fights <= 2) return -0.04;  // debut / newcomer
    if (fights <= 5) return 0;
    if (fights <= 10) return 0.03;
    if (fights <= 20) return 0.05;
    return 0.06;                    // veteran
  };
  const f1ExpScore = expScore(f1.totalUfcFights);
  const f2ExpScore = expScore(f2.totalUfcFights);

  // ── Stylistic clash adjustment (Factor 20) ────────────────
  let stylisticRoundsAdj = 0;
  let stylisticMLAdj1 = 0;
  if (f1Style === "striker" && f2Style === "striker") {
    stylisticRoundsAdj = -0.06;
  } else if (f1Style === "grappler" && f2Style === "grappler") {
    stylisticRoundsAdj = 0.04;
  } else if ((f1Style === "grappler" && f2Style === "striker") || (f1Style === "striker" && f2Style === "grappler")) {
    stylisticRoundsAdj = 0.08;
    if (f1Style === "grappler") stylisticMLAdj1 = 0.03;
    else stylisticMLAdj1 = -0.03;
  }

  // ══════════════════════════════════════════════════════════
  //  ROUNDS MODEL — 24-Factor Weighted Score
  //  Weights sum to 100%
  // ══════════════════════════════════════════════════════════

  const earlyFinishScore =
    // Factor 1: Career Win Rate (4%)
    ((f1WinRate + f2WinRate) / 2) * 0.04 +

    // Factor 2: Recent Form (4%)
    ((f1RecentWins + f2RecentWins) / 10) * 0.04 +

    // Factor 3: Win Streak (2%)
    (Math.min(f1.winStreak + f2.winStreak, 10) / 10) * 0.02 +

    // Factor 4: R1 Finish Rate (11%)
    ((f1R1Rate + f2R1Rate) / 2) * 0.11 +

    // Factor 5: R1+R2 Finish Rate (9%)
    ((f1Under2Rate + f2Under2Rate) / 2) * 0.09 +

    // Factor 6: Goes-to-Distance Rate — INVERTED (9%)
    (1 - (f1GoesDistRate + f2GoesDistRate) / 2) * 0.09 +

    // Factor 7: Average Fight Duration — INVERTED (7%)
    (1 - Math.min(combinedAvgRounds / 3, 1)) * 0.07 +

    // Factor 8: SLpM (4%)
    Math.min(combinedStrikesPerMin / 12, 1) * 0.04 +

    // Factor 9: SApM — vulnerability (4%)
    Math.min((f1.strikesAbsorbedPerMin + f2.strikesAbsorbedPerMin) / 8, 1) * 0.04 +

    // Factor 10: Strike Differential (3%)
    Math.min(Math.max(Math.abs(f1StrikeDiff), Math.abs(f2StrikeDiff)) / 4, 1) * 0.03 +

    // Factor 11: Striking Accuracy (3%)
    ((f1StrAcc + f2StrAcc) / 2) * 0.03 +

    // Factor 12: Striking Defense — DAMPENER (5%)
    -(((f1StrDef + f2StrDef) / 2) - 0.5) * 0.05 +

    // Factor 13: Takedown Average (3%)
    Math.min((f1.takedownAvg + f2.takedownAvg) / 8, 1) * 0.03 +

    // Factor 14: Takedown Defense — DAMPENER (4%)
    -(((f1TdDef + f2TdDef) / 2) - 0.5) * 0.04 +

    // Factor 15: Submission Average (3%)
    Math.min((f1SubAvg + f2SubAvg) / 4, 1) * 0.03 +

    // Factor 16: Career Finish Rate (5%)
    ((f1FinishPct + f2FinishPct) / 2) * 0.05 +

    // Factor 17: KO Rate (3%)
    ((f1KoPct + f2KoPct) / 2) * 0.03 +

    // Factor 18: Weight Class Tendency (3%)
    wcBias * 0.03 / 0.14 +

    // Factor 19: Age Factor (2%)
    ((ageFactor(f1.age) + ageFactor(f2.age)) / 2 + 0.05) * 0.02 / 0.10 +

    // Factor 20: Stylistic Clash (4%)
    (-stylisticRoundsAdj) * 0.04 / 0.08 +

    // Factor 21: Reach Advantage — bigger reach gap = more KOs at range (2%)
    Math.min(Math.abs(reachDiff) / 6, 1) * 0.02 +

    // Factor 22: Level of Competition — tougher opponents = more durable = longer fights (2%, dampener)
    -(((f1OppQuality + f2OppQuality) / 2) - 0.50) * 0.02 / 0.05 +

    // Factor 23: Ring Rust — rusty fighters may gas early or get caught (2%)
    (((-f1RingRust) + (-f2RingRust)) / 2 + 0.05) * 0.02 / 0.10 +

    // Factor 24: UFC Experience — experienced fighters manage distance = DAMPENER (2%)
    -(((f1ExpScore + f2ExpScore) / 2)) * 0.02 / 0.06;

  // ── Convert early finish score to probabilities via sigmoid ─
  // earlyFinishScore is roughly in [0, 1]. Use average fight rounds as a strong
  // secondary signal — if both fighters average under 2 rounds, R1 finish is real.
  const avgRoundSignal = Math.max(0, 1 - (combinedAvgRounds / 3.5)); // 0-1, higher = shorter fights
  const r1FinishSignal = (f1R1Rate + f2R1Rate) / 2; // direct R1 finish rate

  // Blend the early finish score with direct round data
  const blendedFinish = earlyFinishScore * 0.5 + avgRoundSignal * 0.25 + r1FinishSignal * 0.25;

  // Center and spread — lower center (0.35) so high-finish matchups can cross
  const centered = (blendedFinish - 0.35) * 10;

  // Under 1.5: P(finish in R1) — shift reduced from -0.8 to -0.3
  const u15Raw = sigmoid(centered - 0.3);
  const u15Prob = Math.min(70, Math.max(10, Math.round(u15Raw * 100)));

  // Under 2.5: P(finish in R1 or R2)
  const u25Raw = sigmoid(centered + 0.3);
  const u25Prob = Math.min(78, Math.max(18, Math.round(u25Raw * 100)));

  // Over 1.5 / 2.5
  const o15Prob = Math.min(82, Math.max(30, 100 - u15Prob));
  const o25Prob = Math.min(78, Math.max(22, 100 - u25Prob));

  // ── Build round predictions ────────────────────────────────
  const roundPredictions: any[] = [];

  if (u15Prob >= 45) {
    roundPredictions.push({
      bet: "Under 1.5 Rounds",
      confidence: u15Prob >= 55 ? "strong" : "lean",
      probability: u15Prob,
      reasoning: `R1 finish rate: ${f1.fighter.name} ${(f1R1Rate * 100).toFixed(0)}%, ${f2.fighter.name} ${(f2R1Rate * 100).toFixed(0)}%. Combined finish rate ${combinedFinishRate.toFixed(0)}%${wcBias > 0.05 ? `. ${f1.fighter?.weight_class} fights tend to end early.` : "."}`,
    });
  } else if (o15Prob >= 55) {
    roundPredictions.push({
      bet: "Over 1.5 Rounds",
      confidence: o15Prob >= 65 ? "strong" : "lean",
      probability: o15Prob,
      reasoning: `Most fights go past R1. ${f1.fighter.name} avg ${f1Rounds.avgRound.toFixed(1)} rds, ${f2.fighter.name} avg ${f2Rounds.avgRound.toFixed(1)} rds.${f1StrDef > 0.55 || f2StrDef > 0.55 ? " Strong defensive fighters extend fights." : ""}`,
    });
  }

  if (u25Prob >= 55) {
    roundPredictions.push({
      bet: "Under 2.5 Rounds",
      confidence: u25Prob >= 65 ? "strong" : "lean",
      probability: u25Prob,
      reasoning: `${((f1Under2Rate + f2Under2Rate) / 2 * 100).toFixed(0)}% of their fights end within 2 rounds. Combined striking: ${combinedStrikesPerMin.toFixed(1)} strikes/min.`,
    });
  } else if (o25Prob >= 50) {
    roundPredictions.push({
      bet: "Over 2.5 Rounds",
      confidence: o25Prob >= 62 ? "strong" : "lean",
      probability: o25Prob,
      reasoning: `${((f1GoesDistRate + f2GoesDistRate) / 2 * 100).toFixed(0)}% of their fights go 3+ rounds. ${f1Style !== f2Style ? "Style clash tends to extend fights. " : ""}Combined finish rate only ${combinedFinishRate.toFixed(0)}%.`,
    });
  }

  // ══════════════════════════════════════════════════════════
  //  MONEYLINE MODEL — 24-Factor Weighted Score
  //  Weights sum to 100%
  // ══════════════════════════════════════════════════════════
  // Each factor produces a differential: positive favors F1, negative favors F2.

  // ── SApM Vulnerability Penalty (STRENGTHENED) ──────────────
  // Fighters absorbing > 3.0 SLpM get a scaled penalty
  const sapmPenalty1 = f1.strikesAbsorbedPerMin > 3.0 ? -0.05 * ((f1.strikesAbsorbedPerMin - 3.0) / 2) : 0;
  const sapmPenalty2 = f2.strikesAbsorbedPerMin > 3.0 ? -0.05 * ((f2.strikesAbsorbedPerMin - 3.0) / 2) : 0;

  // ── Head-to-Head History Detection ────────────────────────
  // Check if these fighters have fought before by scanning recent fights
  let h2hAdj = 0;
  const f1Name = f1.fighter?.name?.toLowerCase() || "";
  const f2Name = f2.fighter?.name?.toLowerCase() || "";
  let f1WinsVsF2 = 0;
  let f2WinsVsF1 = 0;
  for (const fight of f1.recent_fights) {
    if (fight.opponent?.toLowerCase() === f2Name || f2Name.includes(fight.opponent?.toLowerCase())) {
      if (fight.result === "W") f1WinsVsF2++;
      else if (fight.result === "L") f2WinsVsF1++;
    }
  }
  // Each prior win gives a meaningful edge (0.04 per win, capped at 0.10)
  if (f1WinsVsF2 > 0 || f2WinsVsF1 > 0) {
    h2hAdj = Math.min(0.10, (f1WinsVsF2 - f2WinsVsF1) * 0.04);
    console.log(`H2H: ${f1.fighter.name} ${f1WinsVsF2}W-${f2WinsVsF1}L vs ${f2.fighter.name}, adj=${h2hAdj.toFixed(3)}`);
  }

  // ── Estimated Data Penalty ────────────────────────────────
  // If one fighter has real UFCStats and the other doesn't, penalize the estimated one
  // This prevents inflated estimated stats from dominating
  let estimatedPenalty = 0;
  if (f1.hasRealStats && !f2.hasRealStats) estimatedPenalty = -0.04; // penalize f2 → favors f1
  else if (!f1.hasRealStats && f2.hasRealStats) estimatedPenalty = 0.04; // penalize f1 → favors f2
  if (estimatedPenalty !== 0) {
    console.log(`Estimated data penalty applied: ${estimatedPenalty > 0 ? f2.fighter.name : f1.fighter.name} has real stats, other is estimated`);
  }

  const mlDiff =
    // Factor 1: Career Win Rate (11%) — reduced, doesn't account for opponent quality
    (f1WinRate - f2WinRate) * 0.11 +

    // Factor 2: Recent Form (11%) — reduced, raw W/L is noisy
    ((f1RecentWins - f2RecentWins) / 5) * 0.11 +

    // Factor 3: Win Streak (4%) — reduced, overweights padding-level streaks
    ((Math.min(f1.winStreak, 5) - Math.min(f2.winStreak, 5)) / 5) * 0.04 +

    // Factor 4: R1 Finish Rate (2%)
    (f1R1Rate - f2R1Rate) * 0.02 +

    // Factor 5: R1+R2 Finish Rate (2%)
    (f1Under2Rate - f2Under2Rate) * 0.02 +

    // Factor 6: Goes-to-Distance Rate (2%) — inverted
    -(f1GoesDistRate - f2GoesDistRate) * 0.02 +

    // Factor 7: Average Fight Duration (2%) — shorter = more dangerous
    -((f1.avgFightRounds - f2.avgFightRounds) / 3) * 0.02 +

    // Factor 8: SLpM (7%)
    ((f1.strikesPerMin - f2.strikesPerMin) / 6) * 0.07 +

    // Factor 9: SApM (7%) — INCREASED from 4%, absorbing strikes is a huge red flag
    -((f1.strikesAbsorbedPerMin - f2.strikesAbsorbedPerMin) / 6) * 0.07 +

    // Factor 10: Strike Differential (9%) — INCREASED from 7%, best proxy for exchange dominance
    ((f1StrikeDiff - f2StrikeDiff) / 6) * 0.09 +

    // Factor 11: Striking Accuracy (4%)
    (f1StrAcc - f2StrAcc) * 0.04 +

    // Factor 12: Striking Defense (4%)
    (f1StrDef - f2StrDef) * 0.04 +

    // Factor 13: Takedown Average (4%)
    ((f1.takedownAvg - f2.takedownAvg) / 5) * 0.04 +

    // Factor 14: Takedown Defense (3%)
    (f1TdDef - f2TdDef) * 0.03 +

    // Factor 15: Submission Average (3%)
    ((f1SubAvg - f2SubAvg) / 3) * 0.03 +

    // Factor 16: Career Finish Rate (2%)
    (f1FinishPct - f2FinishPct) * 0.02 +

    // Factor 17: KO Rate (3%)
    (f1KoPct - f2KoPct) * 0.03 +

    // Factor 18: Weight Class Tendency (1%) — same for both, no diff
    0 +

    // Factor 19: Age Factor (4%)
    (ageFactor(f1.age) - ageFactor(f2.age)) * 0.04 / 0.08 +

    // Factor 20: Stylistic Clash (3%)
    stylisticMLAdj1 * 0.03 / 0.03 +

    // Factor 21: Reach Advantage (5%) — longer reach = controls distance
    (reachDiff / 8) * 0.05 +

    // Factor 22: Level of Competition (5%) — INCREASED from 4%, battle-tested matters
    (f1OppQuality - f2OppQuality) * 0.05 / 0.10 +

    // Factor 23: Ring Rust (3%) — active fighter has edge over rusty one
    (f1RingRust - f2RingRust) * 0.03 / 0.08 +

    // Factor 24: UFC Experience (5%) — INCREASED from 4%, octagon IQ
    (f1ExpScore - f2ExpScore) * 0.05 / 0.06 +

    // SApM vulnerability penalty (explicit bonus/penalty for reckless fighters)
    (sapmPenalty1 - sapmPenalty2) +

    // Head-to-head history adjustment
    h2hAdj +

    // Estimated data penalty
    estimatedPenalty;

  // ── Convert ML diff to probability via sigmoid ─────────────
  // mlDiff is roughly in [-0.3, 0.3] → scale with 7 (was 8, still a bit aggressive)
  const mlSigInput = mlDiff * 7;
  const f1WinProb = sigmoid(mlSigInput);
  const f1Pct = Math.min(78, Math.max(22, Math.round(f1WinProb * 100))); // cap at 78% (was 82%)
  const f2Pct = 100 - f1Pct;

  const favored = f1Pct >= f2Pct ? f1 : f2;
  const favoredPct = Math.max(f1Pct, f2Pct);
  const edge = Math.abs(f1Pct - 50);

  let mlPick: any;
  if (edge >= 15) {
    mlPick = { pick: favored.fighter.name, confidence: "strong", probability: favoredPct,
      reasoning: `Clear edge across record, activity metrics, and skill differentials. ${favored.fighter.name} scores higher on ${edge >= 20 ? "most" : "several"} of the 24 model factors.` };
  } else if (edge >= 6) {
    mlPick = { pick: favored.fighter.name, confidence: "lean", probability: favoredPct,
      reasoning: `Moderate edge based on overall profile. Competitive matchup but ${favored.fighter.name} holds advantages in key areas.` };
  } else {
    mlPick = { pick: "Toss-up", confidence: "avoid", probability: 50,
      reasoning: `Very even matchup across all 24 factors. Consider round props instead of ML.` };
  }

  // ── Best Bet ───────────────────────────────────────────────
  const allBets = [...roundPredictions.filter(r => r.confidence === "strong"),
    mlPick.confidence === "strong" ? { bet: `ML ${mlPick.pick}`, ...mlPick } : null].filter(Boolean);
  const leanBets = [...roundPredictions.filter(r => r.confidence === "lean"),
    mlPick.confidence === "lean" ? { bet: `ML ${mlPick.pick}`, ...mlPick } : null].filter(Boolean);
  allBets.sort((a: any, b: any) => (b.probability || 0) - (a.probability || 0));
  leanBets.sort((a: any, b: any) => (b.probability || 0) - (a.probability || 0));
  const bestBet = allBets[0] || leanBets[0] || { bet: "No strong play", confidence: "avoid", reasoning: "No clear edge across the 24-factor model.", probability: 45 };

  // ── Significant Strikes O/U ────────────────────────────────
  const sigStrikesPredictions: any[] = [];
  const f1SigStrikesEst = f1.strikesPerMin * f1.avgFightRounds * 5;
  const f2SigStrikesEst = f2.strikesPerMin * f2.avgFightRounds * 5;
  const combinedSigStrikes = f1SigStrikesEst + f2SigStrikesEst;

  for (const line of [80.5, 100.5, 120.5]) {
    const diff = combinedSigStrikes - line;
    const absDiff = Math.abs(diff);
    if (absDiff > 30) {
      sigStrikesPredictions.push({
        bet: `${diff > 0 ? "Over" : "Under"} ${line} Total Sig. Strikes`,
        confidence: "strong", probability: Math.min(82, Math.round(55 + absDiff * 0.4)),
        reasoning: `Combined output estimates ~${combinedSigStrikes.toFixed(0)} sig strikes (${f1.fighter.name}: ${f1.strikesPerMin} SLpM, ${f2.fighter.name}: ${f2.strikesPerMin} SLpM).`,
      });
    } else if (absDiff > 10) {
      sigStrikesPredictions.push({
        bet: `${diff > 0 ? "Over" : "Under"} ${line} Total Sig. Strikes`,
        confidence: "lean", probability: Math.min(70, Math.round(52 + absDiff * 0.3)),
        reasoning: `Projected ~${combinedSigStrikes.toFixed(0)} combined sig strikes based on striking rates and fight duration.`,
      });
    }
  }

  // ── Takedown Predictions ──────────────────────────────────
  const takedownPredictions: any[] = [];
  const f1TdEst = f1.takedownAvg * (f1.avgFightRounds / 3);
  const f2TdEst = f2.takedownAvg * (f2.avgFightRounds / 3);
  const combinedTd = f1TdEst + f2TdEst;

  for (const line of [1.5, 2.5, 3.5]) {
    const diff = combinedTd - line;
    const absDiff = Math.abs(diff);
    if (absDiff > 1.5) {
      takedownPredictions.push({
        bet: `${diff > 0 ? "Over" : "Under"} ${line} Total Takedowns`,
        confidence: "strong", probability: Math.min(80, Math.round(56 + absDiff * 6)),
        reasoning: `Combined TD average projects ~${combinedTd.toFixed(1)} takedowns (${f1.fighter.name}: ${f1.takedownAvg} avg, ${f2.fighter.name}: ${f2.takedownAvg} avg).`,
      });
    } else if (absDiff > 0.5) {
      takedownPredictions.push({
        bet: `${diff > 0 ? "Over" : "Under"} ${line} Total Takedowns`,
        confidence: "lean", probability: Math.min(68, Math.round(52 + absDiff * 5)),
        reasoning: `Projected ~${combinedTd.toFixed(1)} combined takedowns based on career averages.`,
      });
    }
  }

  // ── Method of Victory ─────────────────────────────────────
  const methodPredictions: any[] = [];
  const f1KoProb = f1KoPct * f1WinRate;
  const f2KoProb = f2KoPct * f2WinRate;
  const totalKoProb = Math.min(65, Math.round((f1KoProb + f2KoProb) * 100));

  const f1SubProb = (f1.subRate / 100) * f1WinRate;
  const f2SubProb = (f2.subRate / 100) * f2WinRate;
  const totalSubProb = Math.min(50, Math.round((f1SubProb + f2SubProb) * 100));

  const totalDecProb = Math.max(10, 100 - totalKoProb - totalSubProb);

  if (totalKoProb >= 30) {
    const koFav = f1KoProb > f2KoProb ? f1 : f2;
    methodPredictions.push({
      bet: "Fight ends by KO/TKO", confidence: totalKoProb >= 45 ? "strong" : "lean",
      probability: totalKoProb,
      reasoning: `Combined KO rates are high. ${koFav.fighter.name} has ${koFav.koRate}% KO rate with ${koFav.strikesPerMin} strikes/min.`,
    });
  }
  if (totalSubProb >= 20) {
    const subFav = f1SubProb > f2SubProb ? f1 : f2;
    methodPredictions.push({
      bet: "Fight ends by Submission", confidence: totalSubProb >= 35 ? "strong" : "lean",
      probability: totalSubProb,
      reasoning: `${subFav.fighter.name} has a ${subFav.subRate}% submission rate with ${subFav.takedownAvg} TD avg.`,
    });
  }
  if (totalDecProb >= 35) {
    methodPredictions.push({
      bet: "Fight goes to Decision", confidence: totalDecProb >= 50 ? "strong" : "lean",
      probability: totalDecProb,
      reasoning: `Combined finish rate is only ${combinedFinishRate.toFixed(0)}%. Fights average ${combinedAvgRounds.toFixed(1)} rounds.`,
    });
  }

  // ── Fight to Go the Distance ──────────────────────────────
  const fgtdPredictions: any[] = [];
  const goesDistanceProb = Math.max(10, Math.min(80, Math.round(100 - combinedFinishRate)));
  fgtdPredictions.push({
    bet: goesDistanceProb >= 50 ? "Yes — Goes the Distance" : "No — Does NOT Go the Distance",
    confidence: Math.abs(goesDistanceProb - 50) > 15 ? "strong" : Math.abs(goesDistanceProb - 50) > 5 ? "lean" : "avoid",
    probability: goesDistanceProb >= 50 ? goesDistanceProb : 100 - goesDistanceProb,
    reasoning: `Combined finish rate is ${combinedFinishRate.toFixed(0)}%. Average fight goes ${combinedAvgRounds.toFixed(1)} rounds.`,
  });

  return {
    fighter1: { ...f1.fighter, stats: f1.stats, recent_fights: f1.recent_fights },
    fighter2: { ...f2.fighter, stats: f2.stats, recent_fights: f2.recent_fights },
    comparison: {
      strikes_per_min: { fighter1: f1.strikesPerMin, fighter2: f2.strikesPerMin },
      strikes_absorbed_per_min: { fighter1: f1.strikesAbsorbedPerMin, fighter2: f2.strikesAbsorbedPerMin },
      finish_rate: { fighter1: f1.finishRate, fighter2: f2.finishRate },
      ko_rate: { fighter1: f1.koRate, fighter2: f2.koRate },
      sub_rate: { fighter1: f1.subRate, fighter2: f2.subRate },
      takedown_avg: { fighter1: f1.takedownAvg, fighter2: f2.takedownAvg },
      recent_form: { fighter1: `${f1RecentWins}/5`, fighter2: `${f2RecentWins}/5` },
      avg_fight_rounds: { fighter1: f1.avgFightRounds, fighter2: f2.avgFightRounds },
      win_streak: { fighter1: f1.winStreak, fighter2: f2.winStreak },
    },
    round_predictions: roundPredictions,
    ml_pick: mlPick,
    best_bet: bestBet,
    sig_strikes_predictions: sigStrikesPredictions,
    takedown_predictions: takedownPredictions,
    method_predictions: methodPredictions,
    fgtd_predictions: fgtdPredictions,
    combined_strikes_per_min: combinedStrikesPerMin,
    combined_avg_rounds: combinedAvgRounds,
    combined_finish_rate: combinedFinishRate,
    model_factors: 24,
    fighter_styles: { fighter1: f1Style, fighter2: f2Style },
  };
}

// ── Request Handler ─────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    if (path === "search") {
      const q = url.searchParams.get("q") || "";
      if (q.length < 2) return new Response(JSON.stringify([]), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const results = await searchFighters(q);
      return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "analyze" && req.method === "POST") {
      const { fighter } = await req.json();
      if (!fighter) return new Response(JSON.stringify({ error: "Fighter name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const data = await getFighterData(fighter);
      if ("error" in data) return new Response(JSON.stringify({ error: data.error }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Build single fighter analysis with insights
      const insights: string[] = [];
      if (data.finishRate >= 70) insights.push(`High finisher - ${data.finishRate}% finish rate`);
      if (data.koRate >= 50) insights.push(`Knockout artist - ${data.koRate}% KO rate`);
      if (data.subRate >= 40) insights.push(`Submission specialist - ${data.subRate}% sub rate`);
      if (data.strikesPerMin >= 5) insights.push(`High volume striker - ${data.strikesPerMin} SLpM`);
      if (data.takedownAvg >= 3) insights.push(`Strong wrestler - ${data.takedownAvg} TD avg per 15 min`);
      if (data.strikesAbsorbedPerMin <= 2) insights.push(`Excellent defense - only ${data.strikesAbsorbedPerMin} strikes absorbed per min`);

      const recommendation = data.wins / Math.max(data.wins + data.losses, 1) >= 0.7
        ? { type: "Moneyline", confidence: "lean", reasoning: `${data.fighter.name} has a strong ${data.fighter.record} record with ${data.finishRate}% finish rate.`,
            probability: Math.min(80, Math.round((data.wins / Math.max(data.wins + data.losses, 1)) * 100)) }
        : null;

      return new Response(JSON.stringify({
        fighter: data.fighter, stats: data.stats, recent_fights: data.recent_fights,
        insights, recommendation,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "matchup" && req.method === "POST") {
      const { fighter1, fighter2 } = await req.json();
      if (!fighter1 || !fighter2) return new Response(JSON.stringify({ error: "Two fighter names required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const [f1Data, f2Data] = await Promise.all([getFighterData(fighter1), getFighterData(fighter2)]);
      if ("error" in f1Data) return new Response(JSON.stringify({ error: f1Data.error }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if ("error" in f2Data) return new Response(JSON.stringify({ error: f2Data.error }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const analysis = buildMatchupAnalysis(f1Data as FighterData, f2Data as FighterData);

      // Snapshot logging — fire and forget
      const mlConf = analysis?.recommendation?.probability ?? analysis?.moneyline?.confidence ?? 50;
      logSnapshot({
        sport: "ufc",
        market_type: "moneyline",
        player_or_team: `${(f1Data as FighterData).fighter?.name || fighter1} vs ${(f2Data as FighterData).fighter?.name || fighter2}`,
        confidence: mlConf,
        verdict: analysis?.recommendation?.confidence || null,
        top_factors: null,
      }).catch((err) => console.error("logSnapshot failed:", err));

      return new Response(JSON.stringify(analysis), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
