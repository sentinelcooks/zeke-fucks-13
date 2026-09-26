import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Home, Calendar, DollarSign, Sparkles } from "lucide-react";
import { usePremium } from "@/contexts/PremiumContext";
import { cn } from "@/lib/utils";

// Five tabs (Apple's limit). Settings lives behind the avatar in MobileHeader.
const tabs = [
  { path: "/dashboard/home", icon: Home, label: "Today" },
  { path: "/dashboard/games", icon: Calendar, label: "Games" },
  { path: "/dashboard/analyze", icon: BarChart3, label: "Analyze" },
  { path: "/dashboard/picks", icon: Sparkles, label: "Picks" },
  { path: "/dashboard/tracker", icon: DollarSign, label: "Tracker" },
];

// Sub-routes that should highlight the parent tab
const ROUTE_TAB_MAP: Record<string, string> = {
  "/dashboard/home": "/dashboard/home",
  "/dashboard/picks": "/dashboard/picks",
  "/dashboard/free-props": "/dashboard/picks",
  "/dashboard/analyze": "/dashboard/analyze",
  "/dashboard/moneyline": "/dashboard/analyze",
  "/dashboard/mlb-predictions": "/dashboard/analyze",
  "/dashboard/ufc": "/dashboard/analyze",
  "/dashboard/arbitrage": "/dashboard/analyze",
  "/dashboard/nfl": "/dashboard/analyze",
  "/dashboard/games": "/dashboard/games",
  "/dashboard/tracker": "/dashboard/tracker",
  "/dashboard/parlay": "/dashboard/tracker",
};

const premiumTabs = new Set(["/dashboard/home", "/dashboard/analyze", "/dashboard/picks", "/dashboard/tracker"]);

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status } = usePremium();

  const activeTab = ROUTE_TAB_MAP[location.pathname];

  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
    >
      <div className="pointer-events-auto w-full max-w-[430px] px-5">
        <div className="ios-blur flex h-16 items-center rounded-full px-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.14),inset_0_0_0_0.5px_hsl(var(--hairline))]">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.path;
            const Icon = tab.icon;
            return (
              <button
                key={tab.path}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  if (premiumTabs.has(tab.path) && status !== "active") {
                    navigate("/paywall");
                    return;
                  }
                  navigate(tab.path);
                }}
                className={cn(
                  "flex h-[54px] flex-1 flex-col items-center justify-center gap-px rounded-full text-[11px] font-semibold transition-colors active:scale-95",
                  isActive ? "bg-fill/15 text-primary" : "text-foreground",
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
