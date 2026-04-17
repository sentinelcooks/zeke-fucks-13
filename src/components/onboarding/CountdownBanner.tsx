import { useEffect, useState } from "react";
import { Tag } from "lucide-react";

const STORAGE_KEY = "sentinel_paywall_offer_ends_at";
const WINDOW_MS = 24 * 60 * 60 * 1000;

function getOrInitEndsAt(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const ts = Number(raw);
      if (Number.isFinite(ts) && ts > Date.now()) return ts;
    }
  } catch {}
  const next = Date.now() + WINDOW_MS;
  try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
  return next;
}

function pad(n: number) {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

const CountdownBanner = () => {
  const [endsAt, setEndsAt] = useState<number>(() => getOrInitEndsAt());
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) {
        const next = t + WINDOW_MS;
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
        setEndsAt(next);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const remaining = Math.max(0, endsAt - now);
  const hrs = Math.floor(remaining / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);

  return (
    <div className="w-full rounded-2xl border border-[#2A2A2A] bg-[#141414] px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[#FFC93C]/15 flex items-center justify-center flex-shrink-0">
          <Tag className="w-4 h-4 text-[#FFC93C]" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-wider text-[#FFC93C] leading-tight">
            Limited Time
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#FFC93C]/80 leading-tight">
            20% OFF
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 font-mono">
        {[
          { v: hrs, l: "HRS" },
          { v: mins, l: "MIN" },
          { v: secs, l: "SEC" },
        ].map((u, i) => (
          <div key={u.l} className="flex items-center gap-1.5">
            <div className="flex flex-col items-center">
              <span className="text-base font-extrabold text-white tabular-nums leading-none">{pad(u.v)}</span>
              <span className="text-[8px] text-white/50 mt-0.5 tracking-wider">{u.l}</span>
            </div>
            {i < 2 && <span className="text-white/40 text-base font-bold leading-none -mt-2">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CountdownBanner;
