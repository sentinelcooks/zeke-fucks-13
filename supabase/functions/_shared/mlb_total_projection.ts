export type MlbTotalSide = "over" | "under";

export interface MlbTotalProjectionInput {
  homeRunsPerGame: number | null;
  awayRunsPerGame: number | null;
  homeStarterEra: number | null;
  awayStarterEra: number | null;
  homeBullpenEra: number | null;
  awayBullpenEra: number | null;
  parkFactor: number | null;
  temperatureF: number | null;
  windMph: number | null;
  windDirection: string | null;
  roofClosed: boolean;
}

export interface MlbTotalProjection {
  predictedTotal: number | null;
  projectionInputs: string[];
  missingInputs: string[];
}

const LEAGUE_STARTER_ERA = 4.2;
const LEAGUE_BULLPEN_ERA = 4;

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeMlbScoreboardDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
  }

  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}${month}${day}` : null;
}

export function normalizeMlbScheduleDate(value: string | null | undefined): string | null {
  const scoreboardDate = normalizeMlbScoreboardDate(value);
  if (!scoreboardDate) return null;
  return `${scoreboardDate.slice(0, 4)}-${scoreboardDate.slice(4, 6)}-${scoreboardDate.slice(6, 8)}`;
}

export function buildMlbTotalProjection(input: MlbTotalProjectionInput): MlbTotalProjection {
  const homeRunsPerGame = finiteNumber(input.homeRunsPerGame);
  const awayRunsPerGame = finiteNumber(input.awayRunsPerGame);
  if (homeRunsPerGame === null || awayRunsPerGame === null) {
    return { predictedTotal: null, projectionInputs: [], missingInputs: ["runs_per_game"] };
  }

  const projectionInputs = ["official_current_season_team_runs_per_game"];
  const missingInputs: string[] = [];
  let projectedRuns = homeRunsPerGame + awayRunsPerGame;

  const homeStarterEra = finiteNumber(input.homeStarterEra);
  const awayStarterEra = finiteNumber(input.awayStarterEra);
  if (homeStarterEra !== null && awayStarterEra !== null) {
    projectedRuns += ((homeStarterEra - LEAGUE_STARTER_ERA) + (awayStarterEra - LEAGUE_STARTER_ERA)) * 0.35;
    projectionInputs.push("official_probable_starter_season_era");
  } else {
    missingInputs.push("starter_era");
  }

  const homeBullpenEra = finiteNumber(input.homeBullpenEra);
  const awayBullpenEra = finiteNumber(input.awayBullpenEra);
  if (homeBullpenEra !== null && awayBullpenEra !== null) {
    projectedRuns += ((homeBullpenEra - LEAGUE_BULLPEN_ERA) + (awayBullpenEra - LEAGUE_BULLPEN_ERA)) * 0.15;
    projectionInputs.push("official_relief_pitching_era");
  } else if (homeBullpenEra !== null || awayBullpenEra !== null) {
    missingInputs.push("bullpen_era");
  }

  const parkFactor = finiteNumber(input.parkFactor);
  if (parkFactor !== null) {
    projectedRuns *= parkFactor;
    projectionInputs.push("current_season_park_factor");
  }

  if (!input.roofClosed) {
    const temperatureF = finiteNumber(input.temperatureF);
    if (temperatureF !== null) {
      projectedRuns *= temperatureF > 75 ? 1.03 : temperatureF < 55 ? 0.97 : 1;
      projectionInputs.push("official_game_weather_temperature");
    }

    const windMph = finiteNumber(input.windMph);
    const windDirection = input.windDirection?.toLowerCase();
    if (windMph !== null && windDirection) {
      projectedRuns *= windDirection.includes("out")
        ? 1 + windMph * 0.008
        : windDirection.includes("in") ? 1 - windMph * 0.005 : 1;
      projectionInputs.push("official_game_weather_wind");
    }
  }

  return { predictedTotal: roundToTenth(projectedRuns), projectionInputs, missingInputs };
}

export function scoreMlbTotalSide(input: {
  predictedTotal: number | null | undefined;
  totalLine: number | null | undefined;
  side: string | null | undefined;
}): number | null {
  const predictedTotal = finiteNumber(input.predictedTotal);
  const totalLine = finiteNumber(input.totalLine);
  const side = input.side?.toLowerCase();
  if (predictedTotal === null || totalLine === null || totalLine <= 0 || (side !== "over" && side !== "under")) {
    return null;
  }

  // This is an uncalibrated directional score. It is intentionally not a probability.
  const overScore = Math.max(10, Math.min(90, Math.round(50 + (predictedTotal - totalLine) * 8)));
  return side === "over" ? overScore : 100 - overScore;
}

export function describeMlbTotalProjection(input: {
  predictedTotal: number | null | undefined;
  totalLine: number | null | undefined;
  side: string | null | undefined;
  projectionInputs: string[];
  missingInputs: string[];
}): string {
  const predictedTotal = finiteNumber(input.predictedTotal);
  const totalLine = finiteNumber(input.totalLine);
  const side = input.side?.toLowerCase();
  if (predictedTotal === null || totalLine === null || (side !== "over" && side !== "under")) {
    return "The verified MLB total inputs could not produce a usable line comparison.";
  }

  const difference = roundToTenth(predictedTotal - totalLine);
  const supportsSelectedSide = side === "over" ? difference > 0 : difference < 0;
  const comparison = difference === 0
    ? "The projection matches the live total, so the model has no directional separation."
    : supportsSelectedSide
      ? `The projection is ${Math.abs(difference).toFixed(1)} runs ${side === "over" ? "above" : "below"} the line, which directionally supports the ${side}.`
      : `The projection is ${Math.abs(difference).toFixed(1)} runs ${side === "over" ? "below" : "above"} the line, so it does not directionally support the ${side}.`;
  const sourceSummary = input.projectionInputs.length
    ? `Verified inputs: ${input.projectionInputs.join(", ")}.`
    : "Verified inputs were limited.";
  const missingSummary = input.missingInputs.length
    ? ` Unavailable inputs: ${input.missingInputs.join(", ")}.`
    : "";

  return `The verified total projection is ${predictedTotal.toFixed(1)} runs against ${side} ${totalLine.toFixed(1)}. ${comparison} ${sourceSummary}${missingSummary}`;
}
