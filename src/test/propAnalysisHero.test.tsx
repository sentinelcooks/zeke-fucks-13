import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PropAnalysisHero } from "@/components/playbook/PropAnalysisHero";

// 12 starts, oldest first, like the analyzer's game_log.
const K = [6, 9, 7, 8, 10, 5, 9, 7, 11, 8, 12, 7];
const gameLog = K.map((k, i) => ({
  date: `09/${String(i + 1).padStart(2, "0")}`,
  matchup: i % 2 ? `DET @ T${i}` : `DET vs. T${i}`,
  result: "W",
  stat_value: k,
  K: k,
}));

const base = {
  sport: "mlb",
  playerName: "Tarik Skubal",
  propLabel: "Strikeouts",
  propType: "strikeouts",
  line: 7.5,
  direction: "over" as const,
  gameLog,
};

const splitTab = (label: string) =>
  within(screen.getByRole("tablist", { name: "Games shown" })).getByRole("tab", { name: new RegExp(`^${label}`) });

describe("PropAnalysisHero", () => {
  it("shows L10 numbers computed from the game log", () => {
    render(<PropAnalysisHero {...base} />);
    // L10 = [7,8,10,5,9,7,11,8,12,7] → 6 of 10 over 7.5, avg 8.4
    expect(screen.getByText("8.4")).toBeInTheDocument();
    expect(splitTab("L10")).toHaveTextContent("60%");
    expect(splitTab("L20")).toHaveTextContent("58%"); // 7 of 12 over
    expect(screen.getAllByRole("button", { name: /7\.5|9\/\d+/ }).length).toBeGreaterThan(0);
  });

  it("renders the grade ring only when a model score exists", () => {
    const { rerender } = render(<PropAnalysisHero {...base} />);
    expect(screen.queryByRole("button", { name: /Model score/ })).not.toBeInTheDocument();
    rerender(<PropAnalysisHero {...base} modelScore={66} />);
    expect(screen.getByRole("button", { name: /Model score 66/ })).toBeInTheDocument();
  });

  it("recounts hit rates for a custom line and can reset", () => {
    render(<PropAnalysisHero {...base} modelScore={66} />);
    fireEvent.click(screen.getByRole("button", { name: "Raise the line" }));
    fireEvent.click(screen.getByRole("button", { name: "Raise the line" }));
    // Over 8.5 in L10: 10, 9, 11, 12 → 40%
    expect(splitTab("L10")).toHaveTextContent("40%");
    expect(screen.getByText(/Hit rates use Over 8\.5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(splitTab("L10")).toHaveTextContent("60%");
    expect(screen.queryByText(/Hit rates use/)).not.toBeInTheDocument();
  });

  it("hides line controls and shows a message when there is no game log", () => {
    render(<PropAnalysisHero {...base} gameLog={[]} />);
    expect(screen.getByText(/No game log is available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise the line" })).not.toBeInTheDocument();
  });

  it("uses H2H rows for the H2H split", () => {
    render(<PropAnalysisHero {...base} h2hRows={[{ date: "04/12", matchup: "DET vs. CLE", stat_value: 9 }, { date: "06/03", matchup: "DET @ CLE", stat_value: 6 }]} />);
    expect(splitTab("H2H")).toHaveTextContent("50%");
  });
});
