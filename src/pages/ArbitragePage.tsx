import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, Scan, Loader2, ArrowRightLeft, DollarSign, TrendingUp, AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";

import { fetchNbaOdds, type OddsEvent } from "@/services/oddsApi";
import { useOddsFormat } from "@/hooks/useOddsFormat";

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

function impliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function decimalFromAmerican(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function americanFromDecimal(dec: number): number {
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

function impliedProbDecimal(dec: number): number {
  return 1 / dec;
}

function isArbOpportunity(odds1: number, odds2: number): boolean {
  const p1 = impliedProb(odds1);
  const p2 = impliedProb(odds2);
  return p1 + p2 < 1;
}

function arbProfit(odds1: number, odds2: number, totalStake: number) {
  const d1 = decimalFromAmerican(odds1);
  const d2 = decimalFromAmerican(odds2);
  const inv = 1 / d1 + 1 / d2;
  if (inv >= 1) return null;
  const stake1 = totalStake * (1 / d1) / inv;
  const stake2 = totalStake * (1 / d2) / inv;
  const payout = stake1 * d1;
  const profit = payout - totalStake;
  const profitPct = (profit / totalStake) * 100;
  return { stake1: +stake1.toFixed(2), stake2: +stake2.toFixed(2), payout: +payout.toFixed(2), profit: +profit.toFixed(2), profitPct: +profitPct.toFixed(2) };
}

/** Given one side's stake and both decimal odds, compute the optimal other side stake for equal payout */
function calcOtherSideStake(knownStake: number, knownDecOdds: number, otherDecOdds: number) {
  // Equal payout: knownStake * knownDecOdds = otherStake * otherDecOdds
  const otherStake = (knownStake * knownDecOdds) / otherDecOdds;
  const totalStake = knownStake + otherStake;
  const payout = knownStake * knownDecOdds;
  const profit = payout - totalStake;
  const profitPct = totalStake > 0 ? (profit / totalStake) * 100 : 0;
  return {
    otherStake: +otherStake.toFixed(2),
    totalStake: +totalStake.toFixed(2),
    payout: +payout.toFixed(2),
    profit: +profit.toFixed(2),
    profitPct: +profitPct.toFixed(2),
  };
}

/* ══════════════════════════════════════════════════════════════
   TAB SELECTOR
   ══════════════════════════════════════════════════════════════ */
function TabSelector({ tab, setTab }: { tab: "calc" | "scanner"; setTab: (t: "calc" | "scanner") => void }) {
  return (
    <div className="flex gap-1 p-1 rounded-2xl" style={{ background: 'hsl(var(--secondary))' }}>
      {[
        { key: "calc" as const, label: "Calculator", icon: Calculator },
        { key: "scanner" as const, label: "Scanner", icon: Scan },
      ].map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-semibold tracking-wide transition-all ${
            tab === key ? "text-accent-foreground" : "text-muted-foreground"
          }`}
        >
          {tab === key && (
            <motion.div
              layoutId="arb-tab-bg"
              className="absolute inset-0 rounded-xl"
              style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(210 100% 60%))' }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
            />
          )}
          <Icon className="relative z-10 w-3.5 h-3.5" />
          <span className="relative z-10">{label}</span>
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ARBITRAGE CALCULATOR — Premium Sentinel Design
   ══════════════════════════════════════════════════════════════ */
function ArbCalculator() {
  const { oddsFormat } = useOddsFormat();
  const isDecimal = oddsFormat === "decimal";
  const [odds1, setOdds1] = useState("");
  const [odds2, setOdds2] = useState("");
  const [stake1, setStake1] = useState("");
  const [stake2, setStake2] = useState("");
  const [lastEdited, setLastEdited] = useState<"a" | "b" | null>(null);

  const parseToAmerican = useCallback((val: string): number | null => {
    const n = parseFloat(val);
    if (isNaN(n)) return null;
    if (isDecimal) { if (n <= 1) return null; return americanFromDecimal(n); }
    return n;
  }, [isDecimal]);

  const am1 = parseToAmerican(odds1);
  const am2 = parseToAmerican(odds2);
  const d1 = am1 !== null ? decimalFromAmerican(am1) : null;
  const d2 = am2 !== null ? decimalFromAmerican(am2) : null;

  const s1 = parseFloat(stake1);
  const s2 = parseFloat(stake2);

  const effectiveStake1 = useMemo(() => {
    if (lastEdited === "a" && !isNaN(s1)) return s1;
    if (lastEdited === "b" && !isNaN(s2) && d1 && d2) return +((s2 * d2) / d1).toFixed(2);
    if (!isNaN(s1)) return s1;
    return 0;
  }, [lastEdited, s1, s2, d1, d2]);

  const effectiveStake2 = useMemo(() => {
    if (lastEdited === "b" && !isNaN(s2)) return s2;
    if (lastEdited === "a" && !isNaN(s1) && d1 && d2) return +((s1 * d1) / d2).toFixed(2);
    if (!isNaN(s2)) return s2;
    return 0;
  }, [lastEdited, s1, s2, d1, d2]);

  const payout1 = d1 && effectiveStake1 > 0 ? +(effectiveStake1 * d1).toFixed(2) : 0;
  const payout2 = d2 && effectiveStake2 > 0 ? +(effectiveStake2 * d2).toFixed(2) : 0;
  const totalStake = +(effectiveStake1 + effectiveStake2).toFixed(2);
  const totalPayout = Math.max(payout1, payout2);
  const profit = +(totalPayout - totalStake).toFixed(2);
  const profitPct = totalStake > 0 ? +((profit / totalStake) * 100).toFixed(2) : 0;

  const totalImplied = useMemo(() => {
    if (am1 === null || am2 === null) return null;
    return +(impliedProb(am1) * 100 + impliedProb(am2) * 100).toFixed(1);
  }, [am1, am2]);
  const hasArb = totalImplied !== null && totalImplied < 100;
  const hasOdds = am1 !== null && am2 !== null;

  const formatLabel = isDecimal ? "Decimal" : "American";
  const ph1 = isDecimal ? "2.50" : "+150";
  const ph2 = isDecimal ? "1.77" : "-120";

  const handleStake1 = (v: string) => { setStake1(v); setLastEdited("a"); };
  const handleStake2 = (v: string) => { setStake2(v); setLastEdited("b"); };

  const displayStake1 = lastEdited === "b" && !isNaN(s2) && d1 && d2 ? effectiveStake1.toFixed(2) : stake1;
  const displayStake2 = lastEdited === "a" && !isNaN(s1) && d1 && d2 ? effectiveStake2.toFixed(2) : stake2;

  const imp1 = am1 !== null ? (impliedProb(am1) * 100).toFixed(1) : null;
  const imp2 = am2 !== null ? (impliedProb(am2) * 100).toFixed(1) : null;

  return (
    <div className="space-y-4">
      {/* Main Calculator Card */}
      <div
        className="relative rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, hsl(228 28% 12%), hsl(228 24% 7%))',
          border: '1px solid hsla(250, 76%, 62%, 0.15)',
          boxShadow: '0 8px 40px -12px hsla(250, 76%, 62%, 0.15), inset 0 1px 0 0 hsla(0, 0%, 100%, 0.04)',
        }}
      >
        {/* Ambient glow */}
        <div
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl pointer-events-none opacity-30"
          style={{ background: 'hsl(var(--accent))' }}
        />

        <div className="relative z-10 p-5 space-y-5">
          {/* Header with format badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'hsla(250, 76%, 62%, 0.15)' }}>
                <Calculator className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Arb Calculator</h3>
                <p className="text-[9px] text-muted-foreground">Auto-balance for max profit</p>
              </div>
            </div>
            <span
              className="text-[10px] px-3 py-1 rounded-full font-bold tracking-wider uppercase"
              style={{
                background: 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.2), hsla(210, 100%, 60%, 0.1))',
                color: 'hsl(var(--accent))',
                border: '1px solid hsla(250, 76%, 62%, 0.2)',
              }}
            >
              {formatLabel}
            </span>
          </div>

          {/* Side Labels */}
          <div className="grid grid-cols-[1fr_28px_1fr] gap-0 items-center">
            <div className="text-center">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-accent/80">Side A</span>
            </div>
            <div className="flex items-center justify-center">
              <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-accent/80">Side B</span>
            </div>
          </div>

          {/* Odds Inputs */}
          <div className="grid grid-cols-[1fr_28px_1fr] gap-0 items-center">
            <div className="space-y-1.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Odds</label>
              <div className="relative group">
                <input
                  type="text" inputMode="decimal" value={odds1} onChange={e => setOdds1(e.target.value)}
                  placeholder={ph1}
                  className="w-full h-12 rounded-2xl px-4 text-center text-lg font-bold font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none transition-all"
                  style={{
                    background: 'hsla(228, 20%, 8%, 0.8)',
                    border: odds1 ? '1.5px solid hsla(250, 76%, 62%, 0.4)' : '1.5px solid hsla(228, 18%, 18%, 0.6)',
                    boxShadow: odds1 ? '0 0 20px -8px hsla(250, 76%, 62%, 0.2)' : 'none',
                  }}
                />
                {imp1 && <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground/60">{imp1}% implied</span>}
              </div>
            </div>
            <div />
            <div className="space-y-1.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Odds</label>
              <div className="relative group">
                <input
                  type="text" inputMode="decimal" value={odds2} onChange={e => setOdds2(e.target.value)}
                  placeholder={ph2}
                  className="w-full h-12 rounded-2xl px-4 text-center text-lg font-bold font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none transition-all"
                  style={{
                    background: 'hsla(228, 20%, 8%, 0.8)',
                    border: odds2 ? '1.5px solid hsla(250, 76%, 62%, 0.4)' : '1.5px solid hsla(228, 18%, 18%, 0.6)',
                    boxShadow: odds2 ? '0 0 20px -8px hsla(250, 76%, 62%, 0.2)' : 'none',
                  }}
                />
                {imp2 && <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground/60">{imp2}% implied</span>}
              </div>
            </div>
          </div>

          {/* Stake Inputs */}
          <div className="grid grid-cols-[1fr_28px_1fr] gap-0 items-center pt-2">
            <div className="space-y-1.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Stake</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 text-sm font-bold font-mono">$</span>
                <input
                  type="text" inputMode="decimal" value={displayStake1}
                  onChange={e => handleStake1(e.target.value)}
                  onFocus={() => setLastEdited("a")}
                  placeholder="100"
                  className="w-full h-12 rounded-2xl pl-8 pr-4 text-center text-lg font-bold font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none transition-all"
                  style={{
                    background: 'hsla(228, 20%, 8%, 0.8)',
                    border: lastEdited === "b" && effectiveStake1 > 0
                      ? '1.5px solid hsla(158, 64%, 52%, 0.4)'
                      : '1.5px solid hsla(228, 18%, 18%, 0.6)',
                    boxShadow: lastEdited === "b" && effectiveStake1 > 0 ? '0 0 20px -8px hsla(158, 64%, 52%, 0.2)' : 'none',
                  }}
                />
                {lastEdited === "b" && effectiveStake1 > 0 && (
                  <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[7px] font-semibold text-nba-green/70">auto</span>
                )}
              </div>
            </div>
            <div />
            <div className="space-y-1.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Stake</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 text-sm font-bold font-mono">$</span>
                <input
                  type="text" inputMode="decimal" value={displayStake2}
                  onChange={e => handleStake2(e.target.value)}
                  onFocus={() => setLastEdited("b")}
                  placeholder="100"
                  className="w-full h-12 rounded-2xl pl-8 pr-4 text-center text-lg font-bold font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none transition-all"
                  style={{
                    background: 'hsla(228, 20%, 8%, 0.8)',
                    border: lastEdited === "a" && effectiveStake2 > 0
                      ? '1.5px solid hsla(158, 64%, 52%, 0.4)'
                      : '1.5px solid hsla(228, 18%, 18%, 0.6)',
                    boxShadow: lastEdited === "a" && effectiveStake2 > 0 ? '0 0 20px -8px hsla(158, 64%, 52%, 0.2)' : 'none',
                  }}
                />
                {lastEdited === "a" && effectiveStake2 > 0 && (
                  <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[7px] font-semibold text-nba-green/70">auto</span>
                )}
              </div>
            </div>
          </div>

          {/* Payout Display */}
          <div className="grid grid-cols-[1fr_28px_1fr] gap-0 items-center pt-2">
            <div className="space-y-1.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Payout</label>
              <div
                className="h-12 rounded-2xl flex items-center justify-center"
                style={{
                  background: payout1 > 0 ? 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.08), hsla(210, 100%, 60%, 0.04))' : 'hsla(228, 20%, 8%, 0.5)',
                  border: `1.5px solid ${payout1 > 0 ? 'hsla(250, 76%, 62%, 0.15)' : 'hsla(228, 18%, 18%, 0.3)'}`,
                }}
              >
                <span className="text-lg font-bold font-mono text-foreground">
                  ${payout1 > 0 ? payout1.toFixed(2) : "0.00"}
                </span>
              </div>
            </div>
            <div />
            <div className="space-y-1.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pl-1">Payout</label>
              <div
                className="h-12 rounded-2xl flex items-center justify-center"
                style={{
                  background: payout2 > 0 ? 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.08), hsla(210, 100%, 60%, 0.04))' : 'hsla(228, 20%, 8%, 0.5)',
                  border: `1.5px solid ${payout2 > 0 ? 'hsla(250, 76%, 62%, 0.15)' : 'hsla(228, 18%, 18%, 0.3)'}`,
                }}
              >
                <span className="text-lg font-bold font-mono text-foreground">
                  ${payout2 > 0 ? payout2.toFixed(2) : "0.00"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Bar */}
        <div
          className="relative z-10 px-5 py-4 mt-1"
          style={{
            background: hasArb
              ? 'linear-gradient(135deg, hsla(160, 84%, 39%, 0.1), hsla(160, 84%, 39%, 0.03))'
              : profit > 0
                ? 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.06), transparent)'
                : 'hsla(228, 20%, 6%, 0.6)',
            borderTop: '1px solid hsla(0, 0%, 100%, 0.04)',
          }}
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[8px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1">Total Stake</p>
              <p className="text-lg font-extrabold font-mono text-foreground">${totalStake > 0 ? totalStake.toFixed(2) : "0.00"}</p>
            </div>
            <div>
              <p className="text-[8px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1">Total Payout</p>
              <p className="text-lg font-extrabold font-mono text-foreground">${totalPayout > 0 ? totalPayout.toFixed(2) : "0.00"}</p>
            </div>
            <div>
              <p className="text-[8px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-1">Profit ({profitPct}%)</p>
              <p className={`text-lg font-extrabold font-mono ${profit > 0 ? 'text-nba-green' : profit < 0 ? 'text-nba-red' : 'text-foreground'}`}>
                {profit > 0 ? '+' : ''}${profit.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Arb Status */}
      {hasOdds && totalImplied !== null && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{
            background: hasArb
              ? 'linear-gradient(135deg, hsla(160, 84%, 39%, 0.12), hsla(160, 84%, 39%, 0.03))'
              : 'linear-gradient(135deg, hsla(0, 72%, 51%, 0.08), hsla(0, 72%, 51%, 0.02))',
            border: `1px solid ${hasArb ? 'hsla(160, 84%, 39%, 0.2)' : 'hsla(0, 72%, 51%, 0.15)'}`,
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: hasArb ? 'hsla(160, 84%, 39%, 0.15)' : 'hsla(0, 72%, 51%, 0.1)' }}
          >
            {hasArb ? <CheckCircle2 className="w-5 h-5 text-nba-green" /> : <AlertTriangle className="w-5 h-5 text-nba-red" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-foreground">
              {hasArb ? "Arbitrage Opportunity Found!" : "No Arbitrage Available"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {hasArb
                ? `${(100 - totalImplied).toFixed(1)}% edge — guaranteed ${profitPct}% ROI`
                : `Combined implied: ${totalImplied}% — need below 100%`}
            </p>
          </div>
          <span className={`text-xl font-black font-mono ${hasArb ? 'text-nba-green' : 'text-nba-red/70'}`}>
            {totalImplied}%
          </span>
        </motion.div>
      )}

      {/* Guide */}
      <div
        className="rounded-2xl p-4 space-y-2"
        style={{
          background: 'linear-gradient(135deg, hsla(228, 24%, 12%, 0.8), hsla(228, 24%, 8%, 0.8))',
          border: '1px solid hsla(228, 18%, 15%, 0.5)',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: 'hsla(250, 76%, 62%, 0.12)' }}>
            <TrendingUp className="w-3 h-3 text-accent" />
          </div>
          <p className="text-[11px] font-bold text-foreground/80">How it works</p>
        </div>
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed pl-7">
          Enter {isDecimal ? "decimal" : "American"} odds for both sides. Type a stake on either side and the other auto-calculates for equal payouts. If the combined implied probability drops below 100%, you've locked in a guaranteed profit.
        </p>
      </div>
    </div>
  );
}

function formatMarketLabel(mktKey: string, pointVal: string): string {
  if (mktKey === "h2h") return "Moneyline";
  if (mktKey === "spreads") return `Spread ${pointVal !== "none" ? pointVal : ""}`.trim();
  if (mktKey === "totals") return `Total ${pointVal !== "none" ? pointVal : ""}`.trim();
  return mktKey;
}

/* ══════════════════════════════════════════════════════════════
   ARBITRAGE SCANNER
   ══════════════════════════════════════════════════════════════ */

interface ArbOpp {
  event: string;
  market: string;
  outcome1: { book: string; name: string; odds: number };
  outcome2: { book: string; name: string; odds: number };
  profitPct: number;
  totalImplied: number;
  isTrue: boolean; // true arb vs near-arb
}

function ArbScanner() {
  const { fmt } = useOddsFormat();
  const [loading, setLoading] = useState(false);
  const [arbs, setArbs] = useState<ArbOpp[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [error, setError] = useState("");

  const scan = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const raw = await fetchNbaOdds();
      const events: OddsEvent[] = Array.isArray(raw) ? raw : (raw?.events || []);
      console.log("[ArbScanner] events count:", events.length, "sample:", events[0]?.bookmakers?.length, "bookmakers");

      if (!events.length) { setError("No odds data available right now"); setLoading(false); return; }

      const found: ArbOpp[] = [];

      // MAX_OVERROUND: show opportunities up to 5% overround (near-arbs)
      const MAX_OVERROUND = 105;

      for (const ev of events) {
        if (!ev.bookmakers?.length) continue;
        const eventLabel = `${ev.away_team} @ ${ev.home_team}`;

        // For each market, group by (market_key, point) and collect best odds per side
        // Structure: { "h2h": { "none": { "Team A": [{book, odds}], "Team B": [{book, odds}] } } }
        const marketGroups: Record<string, Record<string, Record<string, Array<{ book: string; odds: number }>>>> = {};

        for (const bk of ev.bookmakers) {
          for (const mkt of bk.markets) {
            if (!marketGroups[mkt.key]) marketGroups[mkt.key] = {};
            const pointKey = "none"; // for h2h
            for (const oc of mkt.outcomes) {
              const pk = oc.point !== undefined ? String(oc.point) : pointKey;
              if (!marketGroups[mkt.key][pk]) marketGroups[mkt.key][pk] = {};
              if (!marketGroups[mkt.key][pk][oc.name]) marketGroups[mkt.key][pk][oc.name] = [];
              marketGroups[mkt.key][pk][oc.name].push({ book: bk.title, odds: oc.price });
            }
          }
        }

        // Now find best odds across books for each side and check for arbs
        for (const [mktKey, pointMap] of Object.entries(marketGroups)) {
          for (const [pointVal, sideMap] of Object.entries(pointMap)) {
            const sideNames = Object.keys(sideMap);

            // For h2h, spreads (2 sides), totals (Over/Under)
            if (sideNames.length === 2) {
              const side1Books = sideMap[sideNames[0]];
              const side2Books = sideMap[sideNames[1]];

              // Find best odds on each side across all books
              const best1 = side1Books.reduce((a, b) => b.odds > a.odds ? b : a);
              const best2 = side2Books.reduce((a, b) => b.odds > a.odds ? b : a);

              // Skip if same book (can't arb same book)
              if (best1.book === best2.book) {
                // Try second-best combo
                const alt1 = side1Books.filter(b => b.book !== best2.book).reduce((a, b) => b.odds > a.odds ? b : a, { book: "", odds: -9999 });
                const alt2 = side2Books.filter(b => b.book !== best1.book).reduce((a, b) => b.odds > a.odds ? b : a, { book: "", odds: -9999 });

                // Pick the better cross-book combo
                const combo1Ti = alt1.book ? impliedProb(alt1.odds) * 100 + impliedProb(best2.odds) * 100 : 999;
                const combo2Ti = alt2.book ? impliedProb(best1.odds) * 100 + impliedProb(alt2.odds) * 100 : 999;

                if (combo1Ti < combo2Ti && combo1Ti < MAX_OVERROUND && alt1.book) {
                  const ti = combo1Ti;
                  const isTrue = ti < 100;
                  found.push({
                    event: eventLabel,
                    market: formatMarketLabel(mktKey, pointVal),
                    outcome1: { book: alt1.book, name: sideNames[0], odds: alt1.odds },
                    outcome2: { book: best2.book, name: sideNames[1], odds: best2.odds },
                    profitPct: isTrue ? +((100 - ti) / ti * 100).toFixed(2) : +(-(ti - 100)).toFixed(2),
                    totalImplied: +ti.toFixed(1),
                    isTrue,
                  });
                } else if (combo2Ti < MAX_OVERROUND && alt2.book) {
                  const ti = combo2Ti;
                  const isTrue = ti < 100;
                  found.push({
                    event: eventLabel,
                    market: formatMarketLabel(mktKey, pointVal),
                    outcome1: { book: best1.book, name: sideNames[0], odds: best1.odds },
                    outcome2: { book: alt2.book, name: sideNames[1], odds: alt2.odds },
                    profitPct: isTrue ? +((100 - ti) / ti * 100).toFixed(2) : +(-(ti - 100)).toFixed(2),
                    totalImplied: +ti.toFixed(1),
                    isTrue,
                  });
                }
                continue;
              }

              const ti = impliedProb(best1.odds) * 100 + impliedProb(best2.odds) * 100;

              if (ti < MAX_OVERROUND) {
                const isTrue = ti < 100;
                found.push({
                  event: eventLabel,
                  market: formatMarketLabel(mktKey, pointVal),
                  outcome1: { book: best1.book, name: sideNames[0], odds: best1.odds },
                  outcome2: { book: best2.book, name: sideNames[1], odds: best2.odds },
                  profitPct: isTrue ? +((100 - ti) / ti * 100).toFixed(2) : +(-(ti - 100)).toFixed(2),
                  totalImplied: +ti.toFixed(1),
                  isTrue,
                });
              }
            }
          }
        }
      }

      // Sort: true arbs first, then by lowest overround
      found.sort((a, b) => {
        if (a.isTrue !== b.isTrue) return a.isTrue ? -1 : 1;
        return a.totalImplied - b.totalImplied;
      });

      console.log("[ArbScanner] found:", found.length, "opportunities");
      setArbs(found.slice(0, 25));
      setLastScan(new Date());
    } catch (e: any) {
      console.error("[ArbScanner] error:", e);
      setError(e?.message || "Scan failed");
    }
    setLoading(false);
  }, []);

  // Auto-scan on mount
  useEffect(() => { scan(); }, []);

  return (
    <div className="space-y-3">
      {/* Scan button */}
      <div className="flex items-center justify-between">
        <div>
          {lastScan && (
            <p className="text-[10px] text-muted-foreground">
              Last scan: {lastScan.toLocaleTimeString()} · {arbs.length} found
            </p>
          )}
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-semibold text-accent-foreground transition-all active:scale-95 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(210 100% 60%))' }}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {loading ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-[11px] text-nba-red" style={{ background: 'hsla(0, 72%, 51%, 0.08)', border: '1px solid hsla(0, 72%, 51%, 0.15)' }}>
          {error}
        </div>
      )}

      {loading && arbs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-[11px] text-muted-foreground">Scanning major sportsbooks for discrepancies...</p>
        </div>
      )}

      {!loading && arbs.length === 0 && lastScan && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Scan className="w-8 h-8 text-muted-foreground/55" />
          <p className="text-sm font-medium text-muted-foreground">No opportunities found</p>
          <p className="text-[10px] text-muted-foreground/60 text-center max-w-[240px]">
            Try scanning again later. Opportunities appear when sportsbooks disagree on odds.
          </p>
        </div>
      )}

      {/* Arb Cards */}
      <AnimatePresence mode="popLayout">
        {arbs.map((arb, i) => {
          const isTrue = arb.isTrue;
          return (
            <motion.div
              key={`${arb.event}-${arb.market}-${i}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-2xl p-4 space-y-3"
              style={{
                background: isTrue
                  ? 'linear-gradient(135deg, hsla(160, 84%, 39%, 0.08), hsl(var(--card)))'
                  : 'hsl(var(--card))',
                border: `1px solid ${isTrue ? 'hsla(160, 84%, 39%, 0.2)' : 'hsl(var(--border))'}`,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    {isTrue && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-nba-green" style={{ background: 'hsla(160, 84%, 39%, 0.2)' }}>TRUE ARB</span>}
                    {!isTrue && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-nba-yellow" style={{ background: 'hsla(43, 96%, 56%, 0.15)' }}>LOW VIG</span>}
                  </div>
                  <p className="text-[11px] font-semibold text-foreground mt-1">{arb.event}</p>
                  <p className="text-[10px] text-muted-foreground">{arb.market}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ background: isTrue ? 'hsla(160, 84%, 39%, 0.15)' : 'hsla(250, 76%, 62%, 0.12)' }}>
                    <span className={`text-[11px] font-bold font-mono ${isTrue ? 'text-nba-green' : 'text-accent'}`}>
                      {isTrue ? `+${arb.profitPct}%` : `${arb.totalImplied}%`}
                    </span>
                  </div>
                  <p className="text-[8px] text-muted-foreground mt-0.5">{isTrue ? "guaranteed" : "combined imp."}</p>
                </div>
              </div>

              {/* Two sides */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ background: 'hsl(var(--secondary))' }}>
                  <p className="text-[9px] text-muted-foreground font-medium mb-0.5">{arb.outcome1.book}</p>
                  <p className="text-[11px] font-semibold text-foreground mb-0.5">{arb.outcome1.name}</p>
                  <p className="text-sm font-bold font-mono text-accent">{fmt(arb.outcome1.odds)}</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'hsl(var(--secondary))' }}>
                  <p className="text-[9px] text-muted-foreground font-medium mb-0.5">{arb.outcome2.book}</p>
                  <p className="text-[11px] font-semibold text-foreground mb-0.5">{arb.outcome2.name}</p>
                  <p className="text-sm font-bold font-mono text-accent">{fmt(arb.outcome2.odds)}</p>
                </div>
              </div>

              {/* Profit example for true arbs */}
              {isTrue && (() => {
                const calc = arbProfit(arb.outcome1.odds, arb.outcome2.odds, 100);
                if (!calc) return null;
                return (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl text-[10px]" style={{ background: 'hsla(160, 84%, 39%, 0.06)' }}>
                    <span className="text-muted-foreground">$100 → ${calc.stake1} + ${calc.stake2}</span>
                    <span className="font-bold text-nba-green">= ${calc.profit} profit</span>
                  </div>
                );
              })()}

              {!isTrue && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl text-[10px]" style={{ background: 'hsla(250, 76%, 62%, 0.06)' }}>
                  <span className="text-muted-foreground">Overround: {(arb.totalImplied - 100).toFixed(1)}%</span>
                  <span className="font-medium text-accent">Very low vig</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {arbs.length > 0 && (
        <p className="text-[9px] text-muted-foreground/50 text-center">
          ⚠️ Odds change rapidly. Verify lines before placing any plays.
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
const ArbitragePage = () => {
  const [tab, setTab] = useState<"calc" | "scanner">("scanner");

  return (
    <div className="flex flex-col min-h-full relative">
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(250 76% 62%)' }} />
      <div className="vision-orb w-36 h-36 top-[600px] -left-12" style={{ background: 'hsl(160 84% 39%)', animationDelay: '-4s' }} />

      <MobileHeader title="Arbitrage" subtitle="Find & calculate guaranteed profits" />

      <div className="px-4 pt-4 pb-32 space-y-3 relative z-10">
        <TabSelector tab={tab} setTab={setTab} />

        <AnimatePresence mode="wait">
          {tab === "calc" ? (
            <motion.div key="calc" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <ArbCalculator />
            </motion.div>
          ) : (
            <motion.div key="scanner" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <ArbScanner />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ArbitragePage;
