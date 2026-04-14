import { motion } from "framer-motion";
import { useMemo } from "react";

interface CourtZone {
  label: string;
  percentage: number;
  attempts: number;
  cx: number;
  cy: number;
  r: number;
}

interface ShotChartProps {
  propType?: string;
  playerName?: string;
  analysisData?: any;
  sport?: string;
}

function getZoneFill(pct: number): string {
  if (pct >= 55) return "hsl(158 64% 52% / 0.85)";
  if (pct >= 48) return "hsl(158 64% 52% / 0.65)";
  if (pct >= 42) return "hsl(158 64% 52% / 0.45)";
  if (pct >= 35) return "hsl(43 96% 56% / 0.55)";
  return "hsl(0 72% 51% / 0.5)";
}

function getZoneStroke(pct: number): string {
  if (pct >= 55) return "hsl(158 64% 52% / 0.6)";
  if (pct >= 48) return "hsl(158 64% 52% / 0.4)";
  if (pct >= 42) return "hsl(158 64% 52% / 0.3)";
  if (pct >= 35) return "hsl(43 96% 56% / 0.4)";
  return "hsl(0 72% 51% / 0.4)";
}

function getTextFill(pct: number): string {
  if (pct >= 48) return "hsl(158 64% 95%)";
  if (pct >= 42) return "hsl(0 0% 95%)";
  if (pct >= 35) return "hsl(43 96% 92%)";
  return "hsl(0 72% 92%)";
}

function getTrailColor(pct: number): string {
  if (pct >= 55) return "hsl(158 64% 52%)";
  if (pct >= 48) return "hsl(158 64% 52%)";
  if (pct >= 42) return "hsl(158 64% 52%)";
  if (pct >= 35) return "hsl(43 96% 56%)";
  return "hsl(0 72% 51%)";
}

function getRadius(attempts: number, allAttempts: number[]): number {
  if (!allAttempts.length) return 6;
  const max = Math.max(...allAttempts);
  const min = Math.min(...allAttempts);
  const range = max - min || 1;
  const normalized = (attempts - min) / range;
  return 4.5 + normalized * 5;
}

// Generate a curved arc path from zone to basket/net
function getShotArcPath(cx: number, cy: number, targetX = 50, targetY = 92): string {
  const midX = (cx + targetX) / 2;
  const dist = Math.sqrt((cx - targetX) ** 2 + (cy - targetY) ** 2);
  const arcHeight = Math.min(dist * 0.45, 25);
  const midY = Math.min(cy, targetY) - arcHeight;
  return `M ${cx} ${cy} Q ${midX} ${midY} ${targetX} ${targetY}`;
}

// NHL Ice Rink SVG
function NhlRink({ zones }: { zones: CourtZone[] }) {
  const goalX = 50;
  const goalY = 92;

  return (
    <svg viewBox="0 0 100 100" className="w-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="nhlGoalGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {zones.map((zone, i) => (
          <linearGradient
            key={`nhl-trail-grad-${i}`}
            id={`nhlTrailGrad${i}`}
            gradientUnits="userSpaceOnUse"
            x1={zone.cx}
            y1={zone.cy}
            x2={goalX}
            y2={goalY}
          >
            <stop offset="0%" stopColor={getTrailColor(zone.percentage)} stopOpacity="0.5" />
            <stop offset="60%" stopColor={getTrailColor(zone.percentage)} stopOpacity="0.15" />
            <stop offset="100%" stopColor={getTrailColor(zone.percentage)} stopOpacity="0" />
          </linearGradient>
        ))}
        {zones.map((_, i) => (
          <style key={`nhl-dash-${i}`}>
            {`
              @keyframes nhlShoot${i} {
                0% { stroke-dashoffset: 60; opacity: 0; }
                15% { opacity: 1; }
                70% { opacity: 0.6; }
                100% { stroke-dashoffset: 0; opacity: 0; }
              }
              .nhl-shot-trail-${i} {
                animation: nhlShoot${i} 2.5s ease-out ${i * 0.2 + 0.3}s infinite;
                stroke-dasharray: 3 57;
                stroke-dashoffset: 60;
              }
            `}
          </style>
        ))}
      </defs>

      {/* Background - ice surface */}
      <rect x="0" y="0" width="100" height="100" rx="12" fill="hsl(210 20% 8%)" stroke="hsl(210 15% 18%)" strokeWidth="0.4" />

      {/* Rink boards outline */}
      <rect x="3" y="3" width="94" height="94" rx="10" fill="none" stroke="hsl(210 15% 22%)" strokeWidth="0.5" />

      {/* Center ice line */}
      <line x1="3" y1="30" x2="97" y2="30" stroke="hsl(0 72% 45% / 0.3)" strokeWidth="0.6" />

      {/* Center circle */}
      <circle cx="50" cy="30" r="8" fill="none" stroke="hsl(210 50% 45% / 0.2)" strokeWidth="0.35" />
      <circle cx="50" cy="30" r="0.8" fill="hsl(210 50% 45% / 0.3)" />

      {/* Blue line */}
      <line x1="3" y1="48" x2="97" y2="48" stroke="hsl(210 80% 50% / 0.25)" strokeWidth="0.8" />

      {/* Offensive zone faceoff circles */}
      <circle cx="25" cy="68" r="8" fill="none" stroke="hsl(0 72% 45% / 0.15)" strokeWidth="0.35" />
      <circle cx="75" cy="68" r="8" fill="none" stroke="hsl(0 72% 45% / 0.15)" strokeWidth="0.35" />
      <circle cx="25" cy="68" r="0.6" fill="hsl(0 72% 45% / 0.3)" />
      <circle cx="75" cy="68" r="0.6" fill="hsl(0 72% 45% / 0.3)" />

      {/* Goal crease */}
      <path d="M 43 93 Q 43 86 50 86 Q 57 86 57 93" fill="hsl(210 80% 50% / 0.08)" stroke="hsl(210 80% 50% / 0.25)" strokeWidth="0.4" />

      {/* Goal net */}
      <g filter="url(#nhlGoalGlow)">
        <rect x="46" y="93" width="8" height="3" rx="0.5" fill="none" stroke="hsl(0 72% 50% / 0.5)" strokeWidth="0.5" />
        <line x1="47" y1="93" x2="47" y2="96" stroke="hsl(0 72% 50% / 0.2)" strokeWidth="0.3" />
        <line x1="49" y1="93" x2="49" y2="96" stroke="hsl(0 72% 50% / 0.2)" strokeWidth="0.3" />
        <line x1="51" y1="93" x2="51" y2="96" stroke="hsl(0 72% 50% / 0.2)" strokeWidth="0.3" />
        <line x1="53" y1="93" x2="53" y2="96" stroke="hsl(0 72% 50% / 0.2)" strokeWidth="0.3" />
      </g>

      {/* Goal line */}
      <line x1="10" y1="93" x2="90" y2="93" stroke="hsl(0 72% 45% / 0.2)" strokeWidth="0.4" />

      {/* Shot arc trails */}
      {zones.filter(z => !["PP Goals", "EV Goals"].includes(z.label)).map((zone, i) => {
        const arcPath = getShotArcPath(zone.cx, zone.cy, goalX, goalY);
        return (
          <g key={`nhl-trail-${i}`}>
            <path
              d={arcPath}
              fill="none"
              stroke={getTrailColor(zone.percentage)}
              strokeWidth="0.25"
              opacity="0.12"
              strokeDasharray="1.5 1.5"
            />
            <path
              d={arcPath}
              fill="none"
              stroke={`url(#nhlTrailGrad${i})`}
              strokeWidth="0.6"
              strokeLinecap="round"
              className={`nhl-shot-trail-${i}`}
            />
          </g>
        );
      })}

      {/* Stat zones */}
      {zones.map((zone, i) => (
        <g key={zone.label}>
          <motion.circle
            cx={zone.cx}
            cy={zone.cy}
            r={zone.r + 1}
            fill="none"
            stroke={getZoneStroke(zone.percentage)}
            strokeWidth="0.3"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: zone.r + 1, opacity: 0.5 }}
            transition={{ delay: i * 0.05 + 0.1, type: "spring", stiffness: 200, damping: 20 }}
          />
          <motion.circle
            cx={zone.cx}
            cy={zone.cy}
            r={zone.r}
            fill={getZoneFill(zone.percentage)}
            stroke={getZoneStroke(zone.percentage)}
            strokeWidth="0.4"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: zone.r, opacity: 1 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 20 }}
          />
          <text
            x={zone.cx}
            y={zone.cy - 0.8}
            textAnchor="middle"
            dominantBaseline="central"
            fill={getTextFill(zone.percentage)}
            fontSize="3.2"
            fontWeight="700"
            fontFamily="-apple-system, 'SF Pro Display', 'Inter', sans-serif"
          >
            {zone.percentage}%
          </text>
          <text
            x={zone.cx}
            y={zone.cy + 2.8}
            textAnchor="middle"
            dominantBaseline="central"
            fill="hsl(0 0% 45%)"
            fontSize="1.8"
            fontWeight="500"
            fontFamily="-apple-system, 'SF Pro Display', 'Inter', sans-serif"
          >
            {zone.label === "PP Goals" || zone.label === "EV Goals" ? `${zone.attempts}G` : `${zone.attempts} SOG`}
          </text>
        </g>
      ))}
    </svg>
  );
}

// NBA Basketball Court SVG
function BasketballCourt({ zones }: { zones: CourtZone[] }) {
  return (
    <svg viewBox="0 0 100 100" className="w-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="basketGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {zones.map((zone, i) => (
          <linearGradient
            key={`trail-grad-${i}`}
            id={`trailGrad${i}`}
            gradientUnits="userSpaceOnUse"
            x1={zone.cx}
            y1={zone.cy}
            x2={50}
            y2={92}
          >
            <stop offset="0%" stopColor={getTrailColor(zone.percentage)} stopOpacity="0.5" />
            <stop offset="60%" stopColor={getTrailColor(zone.percentage)} stopOpacity="0.15" />
            <stop offset="100%" stopColor={getTrailColor(zone.percentage)} stopOpacity="0" />
          </linearGradient>
        ))}
        {zones.map((_, i) => (
          <style key={`dashAnim${i}`}>
            {`
              @keyframes shoot${i} {
                0% { stroke-dashoffset: 60; opacity: 0; }
                15% { opacity: 1; }
                70% { opacity: 0.6; }
                100% { stroke-dashoffset: 0; opacity: 0; }
              }
              .shot-trail-${i} {
                animation: shoot${i} 2.5s ease-out ${i * 0.2 + 0.3}s infinite;
                stroke-dasharray: 3 57;
                stroke-dashoffset: 60;
              }
            `}
          </style>
        ))}
      </defs>

      {/* Background */}
      <rect x="0" y="0" width="100" height="100" rx="2" fill="hsl(0 0% 8%)" stroke="hsl(0 0% 16%)" strokeWidth="0.4" />

      {/* Paint / Key */}
      <rect x="31" y="68" width="38" height="30" fill="none" stroke="hsl(0 0% 20%)" strokeWidth="0.35" />

      {/* Free throw circle */}
      <circle cx="50" cy="68" r="12" fill="none" stroke="hsl(0 0% 20%)" strokeWidth="0.35" />

      {/* 3-point arc */}
      <path d="M 6 98 L 6 70 Q 6 22 50 22 Q 94 22 94 70 L 94 98" fill="none" stroke="hsl(0 0% 20%)" strokeWidth="0.35" />

      {/* Shot arc trails */}
      {zones.map((zone, i) => {
        const arcPath = getShotArcPath(zone.cx, zone.cy);
        return (
          <g key={`trail-${i}`}>
            <path d={arcPath} fill="none" stroke={getTrailColor(zone.percentage)} strokeWidth="0.25" opacity="0.12" strokeDasharray="1.5 1.5" />
            <path d={arcPath} fill="none" stroke={`url(#trailGrad${i})`} strokeWidth="0.6" strokeLinecap="round" className={`shot-trail-${i}`} />
          </g>
        );
      })}

      {/* Basket with glow */}
      <g filter="url(#basketGlow)">
        <circle cx="50" cy="92" r="1.4" fill="none" stroke="hsl(158 64% 52% / 0.6)" strokeWidth="0.5" />
        <rect x="47.5" y="93.4" width="5" height="0.6" fill="hsl(158 64% 52% / 0.3)" rx="0.3" />
      </g>
      <line x1="44" y1="94.5" x2="56" y2="94.5" stroke="hsl(0 0% 22%)" strokeWidth="0.4" />

      {/* Stat zones */}
      {zones.map((zone, i) => (
        <g key={zone.label}>
          <motion.circle
            cx={zone.cx}
            cy={zone.cy}
            r={zone.r + 1}
            fill="none"
            stroke={getZoneStroke(zone.percentage)}
            strokeWidth="0.3"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: zone.r + 1, opacity: 0.5 }}
            transition={{ delay: i * 0.05 + 0.1, type: "spring", stiffness: 200, damping: 20 }}
          />
          <motion.circle
            cx={zone.cx}
            cy={zone.cy}
            r={zone.r}
            fill={getZoneFill(zone.percentage)}
            stroke={getZoneStroke(zone.percentage)}
            strokeWidth="0.4"
            initial={{ r: 0, opacity: 0 }}
            animate={{ r: zone.r, opacity: 1 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 20 }}
          />
          <text
            x={zone.cx}
            y={zone.cy - 0.8}
            textAnchor="middle"
            dominantBaseline="central"
            fill={getTextFill(zone.percentage)}
            fontSize="3.2"
            fontWeight="700"
            fontFamily="-apple-system, 'SF Pro Display', 'Inter', sans-serif"
          >
            {zone.percentage}%
          </text>
          <text
            x={zone.cx}
            y={zone.cy + 2.8}
            textAnchor="middle"
            dominantBaseline="central"
            fill="hsl(0 0% 45%)"
            fontSize="1.8"
            fontWeight="500"
            fontFamily="-apple-system, 'SF Pro Display', 'Inter', sans-serif"
          >
            {zone.attempts} att
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ShotChart({ propType = "points", playerName = "", analysisData, sport = "nba" }: ShotChartProps) {
  const isNhl = sport === "nhl" || analysisData?.shot_chart_type === "nhl";

  const zones: CourtZone[] = useMemo(() => {
    const shotChart = analysisData?.shot_chart;
    if (shotChart && Array.isArray(shotChart) && shotChart.length > 0) {
      const allAttempts = shotChart.map((z: any) => z.attempts);
      return shotChart.map((z: any) => ({
        label: z.label,
        percentage: z.percentage,
        attempts: z.attempts,
        cx: z.cx,
        cy: z.cy,
        r: getRadius(z.attempts, allAttempts),
      }));
    }
    return [];
  }, [analysisData]);

  if (zones.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-xs">
        <p>No {isNhl ? "scoring zone" : "shot chart"} data available for this player</p>
        <p className="mt-1 text-[10px] opacity-60">
          {isNhl ? "Scoring data is available for goal-scoring props" : "Shot data is only available for scoring-based props"}
        </p>
      </div>
    );
  }

  const totalAttempts = zones.reduce((sum, z) => sum + z.attempts, 0);

  return (
    <div className="w-full max-w-[360px] mx-auto">
      {isNhl ? <NhlRink zones={zones} /> : <BasketballCourt zones={zones} />}
      <p className="text-center text-[9px] text-muted-foreground/50 mt-1">
        {isNhl
          ? `Real shooting data · ${totalAttempts} total shots on goal`
          : `Real shooting data · ${totalAttempts} total attempts`
        }
      </p>
    </div>
  );
}
