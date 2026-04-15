import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown } from "lucide-react";
import { searchUfcFighters } from "@/services/api";

export interface UfcLegData {
  fighter1: string;
  fighter2: string;
  pickFighter: "fighter1" | "fighter2";
}

interface Props {
  data: UfcLegData;
  onChange: (data: UfcLegData) => void;
}

export default function UfcLegInput({ data, onChange }: Props) {
  const [sug1, setSug1] = useState<any[]>([]);
  const [sug2, setSug2] = useState<any[]>([]);
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const t1 = useRef<ReturnType<typeof setTimeout>>();
  const t2 = useRef<ReturnType<typeof setTimeout>>();
  const ref1 = useRef<HTMLDivElement>(null);
  const ref2 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref1.current && !ref1.current.contains(e.target as Node)) setShow1(false);
      if (ref2.current && !ref2.current.contains(e.target as Node)) setShow2(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const search = (q: string, side: 1 | 2) => {
    if (side === 1) onChange({ ...data, fighter1: q });
    else onChange({ ...data, fighter2: q });
    const setS = side === 1 ? setSug1 : setSug2;
    const setShow = side === 1 ? setShow1 : setShow2;
    const tRef = side === 1 ? t1 : t2;
    clearTimeout(tRef.current);
    if (q.length < 2) { setShow(false); return; }
    tRef.current = setTimeout(async () => {
      try {
        const res = await searchUfcFighters(q);
        setS(res);
        setShow(res.length > 0);
      } catch { setShow(false); }
    }, 300);
  };

  const renderInput = (value: string, side: 1 | 2, sugs: any[], show: boolean, refEl: React.RefObject<HTMLDivElement>, placeholder: string) => (
    <div className="flex-1 relative" ref={refEl}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
        <input type="text" value={value}
          onChange={(e) => search(e.target.value, side)}
          placeholder={placeholder}
          className="w-full bg-[hsla(228,20%,11%,0.6)] border border-[hsla(228,18%,22%,0.5)] rounded-xl pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/30 transition-all backdrop-blur-sm" />
      </div>
      {show && (
        <div className="absolute top-full left-0 right-0 mt-1 border border-[hsla(228,18%,22%,0.5)] rounded-xl max-h-[160px] overflow-y-auto z-50 shadow-2xl shadow-black/50 backdrop-blur-xl" style={{ background: 'var(--gradient-card)' }}>
          {sugs.map((s, i) => (
            <div key={i} onClick={() => {
              if (side === 1) { onChange({ ...data, fighter1: s.name }); setShow1(false); }
              else { onChange({ ...data, fighter2: s.name }); setShow2(false); }
            }}
              className="flex items-center gap-3.5 px-3 py-2.5 cursor-pointer hover:bg-accent/6 active:bg-accent/10 transition-all first:rounded-t-xl last:rounded-b-xl group">
              <div className="relative w-9 h-9 rounded-full overflow-hidden flex-shrink-0" style={{
                background: 'linear-gradient(135deg, hsla(228,30%,18%,1), hsla(228,30%,10%,1))',
                border: '1px solid hsla(228,30%,22%,0.3)',
              }}>
                {s.headshot ? (
                  <img src={s.headshot} alt={s.name} className="w-full h-full object-cover object-center"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : null}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] font-black text-muted-foreground/45">{s.name?.charAt(0)}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-foreground truncate block">{s.name}</span>
                {s.record && <span className="text-[9px] font-bold text-accent/70 bg-accent/8 px-1 py-0.5 rounded leading-none mt-0.5 inline-block">{s.record}</span>}
              </div>
              <ChevronDown className="w-3 h-3 text-muted-foreground/45 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        {renderInput(data.fighter1, 1, sug1, show1, ref1 as any, "Fighter 1...")}
        <span className="text-[10px] font-black text-accent bg-accent/10 border border-accent/20 px-2 py-1 rounded-lg shrink-0 shadow-[0_0_8px_hsl(250_76%_62%/0.15)]">VS</span>
        {renderInput(data.fighter2, 2, sug2, show2, ref2 as any, "Fighter 2...")}
      </div>
      {/* Pick which fighter */}
      {data.fighter1 && data.fighter2 && (
        <div className="flex gap-1">
          <button onClick={() => onChange({ ...data, pickFighter: "fighter1" })}
            className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all border ${
              data.pickFighter === "fighter1"
                ? "bg-accent/15 border-accent/40 text-accent shadow-[0_0_10px_hsl(250_76%_62%/0.15)]"
                : "bg-[hsla(228,20%,14%,0.5)] border-[hsla(228,18%,20%,0.4)] text-muted-foreground/50"
            }`}>{data.fighter1.split(" ").pop()}</button>
          <button onClick={() => onChange({ ...data, pickFighter: "fighter2" })}
            className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all border ${
              data.pickFighter === "fighter2"
                ? "bg-accent/15 border-accent/40 text-accent shadow-[0_0_10px_hsl(250_76%_62%/0.15)]"
                : "bg-[hsla(228,20%,14%,0.5)] border-[hsla(228,18%,20%,0.4)] text-muted-foreground/50"
            }`}>{data.fighter2.split(" ").pop()}</button>
        </div>
      )}
    </div>
  );
}
