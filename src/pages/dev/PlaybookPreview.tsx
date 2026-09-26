import { useEffect } from "react";
import { useTheme } from "next-themes";
import { PillTabs } from "@/components/playbook/controls";
import { PropAnalysisHero } from "@/components/playbook/PropAnalysisHero";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * Dev-only gallery of Playbook components with sample data (route /dev/playbook,
 * registered only when import.meta.env.DEV). Lets us review both themes without
 * a signed-in session. Nothing here ships to production.
 */

const PITCHER_K = [6, 9, 7, 8, 10, 5, 8, 9, 7, 11, 9, 7, 11, 8, 6, 10, 9, 8, 12, 7];
const OPPONENTS = ["KC", "MIN", "CWS", "CLE", "TB", "BOS", "SEA", "HOU", "TEX", "TOR", "BAL", "LAA", "ATH", "MIL", "SD", "STL", "NYM", "ATL", "PHI", "LAD"];

const sampleGameLog = PITCHER_K.map((k, i) => {
  const d = new Date(2026, 8, 20 - (19 - i) * 5);
  return {
    date: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`,
    matchup: i % 2 ? `DET @ ${OPPONENTS[i]}` : `DET vs. ${OPPONENTS[i]}`,
    result: i % 3 ? "W" : "L",
    stat_value: k,
    IP: ((k + 9) / 2.4).toFixed(1),
    K: k,
    ER: (i * 7) % 4,
    BB: (i * 5) % 3,
    PC: 88 + ((i * 11) % 17),
  };
});

const sampleH2h = [
  { date: "04/12", matchup: "DET vs. CLE", result: "W", stat_value: 8, K: 8 },
  { date: "06/03", matchup: "DET @ CLE", result: "L", stat_value: 10, K: 10 },
  { date: "08/17", matchup: "DET vs. CLE", result: "W", stat_value: 7, K: 7 },
];

const nbaGameLog = [24, 31, 18, 27, 22, 35, 29, 19, 26, 30].map((pts, i) => ({
  date: `03/${String(i * 2 + 1).padStart(2, "0")}`,
  matchup: i % 2 ? `DAL @ ${["PHX", "DEN", "LAL", "GSW", "SAC"][i % 5]}` : `DAL vs. ${["OKC", "MIN", "HOU", "MEM", "UTA"][i % 5]}`,
  result: i % 4 ? "W" : "L",
  stat_value: pts,
  MIN: 34 + (i % 5),
  PTS: pts,
  REB: 6 + (i % 4),
  AST: 7 + (i % 5),
  FG3M: 2 + (i % 3),
}));

export default function PlaybookPreview() {
  const { theme = "dark", setTheme } = useTheme();

  // ?theme=light|dark|system lets screenshots target a theme directly.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("theme");
    if (t === "light" || t === "dark" || t === "system") setTheme(t);
  }, [setTheme]);

  return (
    <div className="mx-auto min-h-screen max-w-[430px] bg-background px-4 pb-24 pt-safe-plus-4">
      <div className="mb-6 flex items-center gap-3">
        <BrandMark size={36} />
        <div>
          <h1 className="text-[22px] font-bold text-foreground">Playbook preview</h1>
          <p className="text-[13px] text-muted-foreground">Dev only · sample data</p>
        </div>
      </div>
      <PillTabs
        ariaLabel="Appearance"
        value={theme as "system" | "light" | "dark"}
        onChange={setTheme}
        options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
      />

      <h2 className="mb-3 mt-8 text-[13px] font-semibold uppercase text-muted-foreground">MLB pitcher · with headshot fallback and model grade</h2>
      <PropAnalysisHero
        sport="mlb"
        playerName="Tarik Skubal"
        teamName="Detroit Tigers"
        position="SP"
        jersey="29"
        propLabel="Strikeouts"
        propType="strikeouts"
        line={7.5}
        direction="over"
        gameLog={sampleGameLog}
        h2hRows={sampleH2h}
        opponentLabel="@ CLE"
        modelScore={66}
      />

      <h2 className="mb-3 mt-10 text-[13px] font-semibold uppercase text-muted-foreground">NBA · no model score, 10 games</h2>
      <PropAnalysisHero
        sport="nba"
        playerName="Luka Dončić"
        teamName="Dallas Mavericks"
        position="G"
        jersey="77"
        propLabel="Points"
        propType="points"
        line={27.5}
        direction="under"
        gameLog={nbaGameLog}
        opponentLabel="vs DEN"
      />

      <h2 className="mb-3 mt-10 text-[13px] font-semibold uppercase text-muted-foreground">Empty game log</h2>
      <PropAnalysisHero sport="nhl" playerName="Sample Skater" propLabel="Shots on goal" line={3.5} direction="over" gameLog={[]} modelScore={0.54} modelIsProbability />
    </div>
  );
}
