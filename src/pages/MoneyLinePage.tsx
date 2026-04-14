import React from "react";
import { useLocation } from "react-router-dom";
import MoneyLineSection from "@/components/MoneyLineSection";

const MoneyLinePage = () => {
  const location = useLocation();
  const state = location.state as { home_team?: string; away_team?: string; sport?: string; autoAnalyze?: boolean } | null;

  return (
    <div className="flex flex-col min-h-full relative">
      {/* Ambient orbs */}
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(250 76% 62%)' }} />
      <div className="vision-orb w-36 h-36 top-[600px] -left-12" style={{ background: 'hsl(210 100% 60%)', animationDelay: '-4s' }} />

      
      <div className="px-4 pt-4 pb-6 space-y-3 relative z-10">
        <MoneyLineSection
          initialTeam1={state?.home_team}
          initialTeam2={state?.away_team}
          initialSport={state?.sport}
          autoAnalyze={state?.autoAnalyze}
        />
      </div>
    </div>
  );
};

export default MoneyLinePage;
