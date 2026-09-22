import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import sample from "./fixtures.nfl-prop-analysis.json";
import { NflPropAnalysisCard, type NflPropAnalysis } from "@/components/nfl/NflPropAnalysisCard";

// Real nfl-player-prop-edge response (Amon-Ra St. Brown rec yds o76.5), factors trimmed.
const base = { ...(sample as unknown as NflPropAnalysis), _isNfl: true as const };

describe("NflPropAnalysisCard", () => {
  it("renders the NFL model analysis, labelled as not a pick while unproven", () => {
    render(<NflPropAnalysisCard data={base} />);
    expect(screen.getByText("Amon-Ra St. Brown")).toBeInTheDocument();
    expect(screen.getByText(/Over 76.5 Receiving Yards/)).toBeInTheDocument();
    expect(screen.getByText("NOT A PICK")).toBeInTheDocument();
    expect(screen.getByText(/in forward testing/)).toBeInTheDocument();
    expect(screen.getByText("NFL model projection")).toBeInTheDocument();
    expect(screen.getByText(/No sportsbook price found/)).toBeInTheDocument();
    expect(screen.queryByText("PLAY")).not.toBeInTheDocument();
  });

  it("shows the PLAY badge only when the engine returns status PLAY", () => {
    const play = { ...base, proven: true, results: base.results.map((r) => ({ ...r, status: "PLAY" as const, no_play_reasons: [] })) };
    render(<NflPropAnalysisCard data={play} />);
    expect(screen.getByText("PLAY")).toBeInTheDocument();
    expect(screen.queryByText("NOT A PICK")).not.toBeInTheDocument();
  });
});
