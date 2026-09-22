import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const gameList = vi.fn();
const propList = vi.fn();
vi.mock("@/services/api", () => ({
  fetchNflGameEdge: (...a: unknown[]) => gameList(...a),
  fetchNflPlayerPropEdge: (...a: unknown[]) => propList(...a),
}));

import NflEdgePage from "@/pages/NflEdgePage";

const game = (market: string, selection: string, edge: number, status: "PLAY" | "NO PLAY") => ({
  game_id: "2026_03_PHI_CHI", home_team: "CHI", away_team: "PHI", commence_time: "2026-09-27T17:00:00Z",
  market_type: market, selection, model_probability: 0.55, no_vig_probability: 0.5, market_price: -110, fair_price: -122,
  edge_percentage: edge, expected_value: 4, confidence: 62, projected_score: { home_team: "CHI", home: 24.1, away_team: "PHI", away: 21.3 },
  status, no_play_reasons: status === "PLAY" ? [] : ["walk-forward backtest found no profitable edge threshold for this market"],
});

describe("NflEdgePage", () => {
  it("shows the proven-only banner and a forward-testing state when no market is proven", async () => {
    gameList.mockResolvedValue({ predictions: [] });
    render(<NflEdgePage />);
    expect(screen.getByText(/Proven picks only\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Moneyline, spread and total models are still in forward testing/)).toBeInTheDocument());
    expect(gameList).toHaveBeenCalledWith({ action: "list", days: 7 });
    expect(propList).not.toHaveBeenCalled(); // engines load independently
  });

  it("renders published game PLAYs", async () => {
    gameList.mockResolvedValue({ predictions: [game("total", "Under 44.5", 4, "PLAY")] });
    render(<NflEdgePage />);
    await waitFor(() => expect(screen.getByText("PHI @ CHI")).toBeInTheDocument());
    expect(screen.getByText("PLAY")).toBeInTheDocument();
  });

  it("props tab loads only the prop engine and does not pad empty slates", async () => {
    gameList.mockResolvedValue({ predictions: [] });
    propList.mockResolvedValue({
      predictions: [{
        game_id: "g", player_name: "Test WR", team: "CHI", opponent: "PHI", position: "WR", prop_type: "rec_yds", side: "over",
        line: 64.5, projection: 71.2, median_projection: 66, p10: 22, p90: 128, model_probability: 0.56, no_vig_probability: 0.5,
        market_price: -110, edge_percentage: 6, expected_value: 7, confidence: 64, status: "NO PLAY",
        no_play_reasons: ["player Questionable (availability unconfirmed)"], commence_time: "2026-09-27T17:00:00Z",
      }],
    });
    render(<NflEdgePage />);
    fireEvent.click(screen.getByText("Player Props"));
    await waitFor(() => expect(propList).toHaveBeenCalledWith({ action: "list", days: 7 }));
    // Only published PLAYs are ever rendered; a NO PLAY row never appears.
    await waitFor(() => expect(screen.getByText(/Prop models are in forward testing/)).toBeInTheDocument());
    expect(screen.queryByText("Test WR")).not.toBeInTheDocument();
  });
});
