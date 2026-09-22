import { useEffect, useState } from "react";

export type CountdownPhase = "upcoming" | "live" | "unknown";

export interface FirstPitchCountdown {
  phase: CountdownPhase;
  /** HH:MM:SS while the game is upcoming, otherwise a status word. */
  display: string;
  label: string;
}

function pad(value: number) {
  return String(Math.floor(value)).padStart(2, "0");
}

/**
 * Formats the time remaining until first pitch.
 *
 * Once the start time passes there is nothing to count down to, so the clock is
 * replaced by the game's state rather than sitting at 00:00:00 — a frozen
 * countdown reads as a broken timer, not as a game in progress.
 */
export function formatCountdown(commenceTime: string | null | undefined, now: number, status?: string | null): FirstPitchCountdown {
  const start = Date.parse(String(commenceTime ?? ""));
  if (!Number.isFinite(start)) {
    return { phase: "unknown", display: "--:--:--", label: "First pitch" };
  }

  const remaining = Math.floor((start - now) / 1000);
  if (remaining <= 0) {
    const normalized = String(status ?? "").toLowerCase();
    const isFinal = normalized.includes("final") || normalized.includes("completed") || normalized.includes("game over");
    return {
      phase: "live",
      display: isFinal ? "Final" : "Live",
      label: isFinal ? "Game status" : "In progress",
    };
  }

  const hours = remaining / 3600;
  const minutes = (remaining % 3600) / 60;
  const seconds = remaining % 60;
  return {
    phase: "upcoming",
    display: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    label: "First pitch",
  };
}

/** Ticks once a second while the game is still upcoming. */
export function useFirstPitchCountdown(commenceTime: string | null | undefined, status?: string | null): FirstPitchCountdown {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const start = Date.parse(String(commenceTime ?? ""));
    // Nothing to tick for once the game has started or the time is unusable.
    if (!Number.isFinite(start) || start - Date.now() <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [commenceTime]);

  return formatCountdown(commenceTime, now, status);
}
