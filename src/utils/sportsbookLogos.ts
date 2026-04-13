import fanduelLogo from "@/assets/books/fanduel.png";
import draftkingsLogo from "@/assets/books/draftkings.png";
import betmgmLogo from "@/assets/books/betmgm.png";
import espnbetLogo from "@/assets/books/espnbet.png";
import fliffLogo from "@/assets/books/fliff.png";
import betriversLogo from "@/assets/books/betrivers.png";
import betonlineLogo from "@/assets/books/betonline.png";
import novigLogo from "@/assets/books/novig.png";

export interface SportsbookInfo {
  label: string;
  logo: string; // imported image path
  color: string;
  abbrev: string;
}

const SPORTSBOOK_DATA: Record<string, SportsbookInfo> = {
  fanduel: { label: "FanDuel", logo: fanduelLogo, color: "#1493ff", abbrev: "FD" },
  draftkings: { label: "DraftKings", logo: draftkingsLogo, color: "#53d337", abbrev: "DK" },
  betmgm: { label: "BetMGM", logo: betmgmLogo, color: "#c4a747", abbrev: "MG" },
  betonlineag: { label: "BetOnline", logo: betonlineLogo, color: "#e53935", abbrev: "BO" },
  espnbet: { label: "ESPN BET", logo: espnbetLogo, color: "#ff4136", abbrev: "ES" },
  fliff: { label: "Fliff", logo: fliffLogo, color: "#7c3aed", abbrev: "FL" },
  betrivers: { label: "BetRivers", logo: betriversLogo, color: "#1e88e5", abbrev: "BR" },
  prizepicks: { label: "PrizePicks", logo: "", color: "#00c853", abbrev: "PP" },
  underdog: { label: "Underdog", logo: "", color: "#ffd600", abbrev: "UD" },
  novig: { label: "Novig", logo: novigLogo, color: "#06b6d4", abbrev: "NV" },
  kalshi: { label: "Kalshi", logo: "", color: "#6366f1", abbrev: "KA" },
  polymarket: { label: "Polymarket", logo: "", color: "#8b5cf6", abbrev: "PM" },
  betr_us_dfs: { label: "Betr", logo: "", color: "#f97316", abbrev: "BT" },
};

export function getSportsbookInfo(key: string): SportsbookInfo {
  const lower = key.toLowerCase().replace(/\s+/g, "");
  for (const [k, v] of Object.entries(SPORTSBOOK_DATA)) {
    if (lower.includes(k) || k.includes(lower)) return v;
  }
  return { label: key, logo: "", color: "#94a3b8", abbrev: key.slice(0, 2).toUpperCase() };
}
