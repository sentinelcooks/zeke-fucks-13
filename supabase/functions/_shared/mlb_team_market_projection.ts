export type MlbTeamMarket = "moneyline" | "spread";

export interface MlbTeamMarketProjectionInput {
  market: MlbTeamMarket;
  team1Name: string;
  team2Name: string;
  team1RunsPerGame: number | null;
  team2RunsPerGame: number | null;
  team1Ops: number | null;
  team2Ops: number | null;
  team1StarterEra: number | null;
  team2StarterEra: number | null;
  team1BullpenEra: number | null;
  team2BullpenEra: number | null;
  team1Spread: number | null;
}

export interface MlbTeamMarketFactor {
  label: string;
  team1Score: number;
  team2Score: number;
  score: number;
  weight: number;
  detail: string;
}

export interface MlbTeamMarketProjection {
  team1Score: number;
  predictedMargin: number | null;
  verdict: string;
  factors: MlbTeamMarketFactor[];
  missingInputs: string[];
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scoreFromDifference(difference: number, multiplier: number): number {
  return Math.max(10, Math.min(90, Math.round(50 + difference * multiplier)));
}

function weightedScore(factors: MlbTeamMarketFactor[]): number {
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight === 0) return 50;
  return Math.round(factors.reduce((sum, factor) => sum + factor.team1Score * factor.weight, 0) / totalWeight);
}

function verdictForScore(team1Score: number, team1Name: string, team2Name: string): string {
  if (team1Score >= 58) return `LEAN ${team1Name}`;
  if (team1Score <= 42) return `LEAN ${team2Name}`;
  return "RISKY";
}

export function buildMlbTeamMarketProjection(input: MlbTeamMarketProjectionInput): MlbTeamMarketProjection | null {
  const team1RunsPerGame = finite(input.team1RunsPerGame);
  const team2RunsPerGame = finite(input.team2RunsPerGame);
  if (team1RunsPerGame === null || team2RunsPerGame === null) return null;

  const factors: MlbTeamMarketFactor[] = [];
  const missingInputs: string[] = [];
  const addFactor = (label: string, team1Score: number, weight: number, detail: string) => {
    factors.push({ label, team1Score, team2Score: 100 - team1Score, score: team1Score, weight, detail });
  };

  const runScore = scoreFromDifference(team1RunsPerGame - team2RunsPerGame, 16);
  addFactor(
    "Current-season run production",
    runScore,
    35,
    `${input.team1Name} ${team1RunsPerGame.toFixed(2)} runs/game vs ${input.team2Name} ${team2RunsPerGame.toFixed(2)}.`,
  );

  const team1Ops = finite(input.team1Ops);
  const team2Ops = finite(input.team2Ops);
  if (team1Ops !== null && team2Ops !== null) {
    addFactor(
      "Current-season OPS",
      scoreFromDifference(team1Ops - team2Ops, 150),
      25,
      `${input.team1Name} OPS ${team1Ops.toFixed(3)} vs ${input.team2Name} OPS ${team2Ops.toFixed(3)}.`,
    );
  } else {
    missingInputs.push("team_ops");
  }

  const team1StarterEra = finite(input.team1StarterEra);
  const team2StarterEra = finite(input.team2StarterEra);
  if (team1StarterEra !== null && team2StarterEra !== null) {
    addFactor(
      "Probable starter ERA",
      scoreFromDifference(team2StarterEra - team1StarterEra, 12),
      25,
      `${input.team1Name} starter ERA ${team1StarterEra.toFixed(2)} vs ${input.team2Name} starter ERA ${team2StarterEra.toFixed(2)}.`,
    );
  } else {
    missingInputs.push("starter_era");
  }

  const team1BullpenEra = finite(input.team1BullpenEra);
  const team2BullpenEra = finite(input.team2BullpenEra);
  if (team1BullpenEra !== null && team2BullpenEra !== null) {
    addFactor(
      "Relief pitching ERA",
      scoreFromDifference(team2BullpenEra - team1BullpenEra, 10),
      15,
      `${input.team1Name} bullpen ERA ${team1BullpenEra.toFixed(2)} vs ${input.team2Name} bullpen ERA ${team2BullpenEra.toFixed(2)}.`,
    );
  } else {
    missingInputs.push("bullpen_era");
  }

  const baseScore = weightedScore(factors);
  const projectedMargin =
    (team1RunsPerGame - team2RunsPerGame) * 0.9 +
    (team1StarterEra !== null && team2StarterEra !== null ? (team2StarterEra - team1StarterEra) * 0.28 : 0) +
    (team1BullpenEra !== null && team2BullpenEra !== null ? (team2BullpenEra - team1BullpenEra) * 0.12 : 0);

  if (input.market === "spread") {
    const team1Spread = finite(input.team1Spread);
    if (team1Spread === null) return null;
    const team1Score = scoreFromDifference(projectedMargin - team1Spread, 12);
    return {
      team1Score,
      predictedMargin: Math.round(projectedMargin * 10) / 10,
      verdict: verdictForScore(team1Score, input.team1Name, input.team2Name),
      factors,
      missingInputs,
    };
  }

  return {
    team1Score: baseScore,
    predictedMargin: Math.round(projectedMargin * 10) / 10,
    verdict: verdictForScore(baseScore, input.team1Name, input.team2Name),
    factors,
    missingInputs,
  };
}
