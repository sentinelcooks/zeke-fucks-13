import { motion } from "framer-motion";
import { useState } from "react";

interface PlayerCardProps {
  name: string;
  team: string;
  position: string;
  jersey: string;
  headshotUrl?: string;
  teamLogoUrl?: string;
}

export function PlayerCard({ name, team, position, jersey, headshotUrl }: PlayerCardProps) {
  const [imgError, setImgError] = useState(false);
  const initials = name.split(" ").map(n => n[0]).join("");
  const showImg = headshotUrl && !imgError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative rounded-2xl overflow-hidden vision-card-glow"
    >
      <div className="relative z-10 flex items-center gap-4 p-4">
        {/* Player Headshot */}
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl overflow-hidden border border-[hsla(228,30%,22%,0.4)]"
            style={{ background: 'linear-gradient(135deg, hsla(228,30%,18%,1), hsla(228,30%,10%,1))' }}
          >
            {showImg && (
              <img
                src={headshotUrl}
                alt={name}
                className="w-full h-full object-cover object-top"
                onError={() => setImgError(true)}
              />
            )}
            {!showImg && (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-2xl font-black text-muted-foreground/45">
                  {initials}
                </span>
              </div>
            )}
          </div>
          {/* Jersey number badge */}
          <div className="absolute -bottom-1.5 -right-1.5 min-w-[26px] h-[22px] rounded-lg flex items-center justify-center px-1 shadow-lg"
            style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))' }}
          >
            <span className="text-[9px] font-black text-white">#{jersey}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-extrabold text-foreground truncate tracking-tight">{name}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] font-bold text-accent bg-accent/10 px-2.5 py-0.5 rounded-lg">{team}</span>
            <span className="text-[10px] text-muted-foreground/65">·</span>
            <span className="text-[11px] text-muted-foreground/60 font-semibold">{position}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
            <span className="text-[9px] text-muted-foreground/65 font-medium uppercase tracking-wider">Active</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
