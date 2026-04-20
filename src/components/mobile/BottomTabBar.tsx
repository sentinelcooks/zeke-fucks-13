import { memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Home, Calendar, Settings, DollarSign, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

const tabs = [
  { path: "/dashboard/home", icon: Home, label: "Home" },
  { path: "/dashboard/games", icon: Calendar, label: "Games" },
  { path: "/dashboard/analyze", icon: BarChart3, label: "Analyze" },
  { path: "/dashboard/picks", icon: Sparkles, label: "Picks" },
  { path: "/dashboard/tracker", icon: DollarSign, label: "Tracker" },
  { path: "/dashboard/settings", icon: Settings, label: "Settings" },
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
  "/dashboard/games": "/dashboard/games",
  "/dashboard/tracker": "/dashboard/tracker",
  "/dashboard/parlay": "/dashboard/tracker",
  "/dashboard/settings": "/dashboard/settings",
  "/dashboard/legal": "/dashboard/settings",
};

export const BottomTabBar = memo(function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = ROUTE_TAB_MAP[location.pathname] || "/dashboard/home";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="w-full max-w-[430px] px-3 pb-1.5 pointer-events-auto">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.1 }}
          className="relative mx-auto w-full flex items-center justify-around"
          style={{
            height: 60,
            borderRadius: 20,
            background: "hsla(230, 25%, 7%, 0.88)",
            backdropFilter: "saturate(200%) blur(40px)",
            WebkitBackdropFilter: "saturate(200%) blur(40px)",
            border: "1px solid hsla(230, 20%, 18%, 0.35)",
            boxShadow: `
              0 -4px 32px -8px hsla(230, 50%, 4%, 0.6),
              0 4px 16px -4px hsla(230, 40%, 4%, 0.4),
              inset 0 0.5px 0 hsla(230, 30%, 40%, 0.08)
            `,
          }}
        >
          {/* Top highlight line */}
          <div
            className="absolute inset-x-6 top-0 h-px rounded-full"
            style={{ background: "linear-gradient(90deg, transparent, hsla(250, 70%, 65%, 0.12), hsla(200, 90%, 60%, 0.08), transparent)" }}
          />

          {tabs.map((tab) => {
            const isActive = activeTab === tab.path;
            const Icon = tab.icon;

            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className="relative flex flex-col items-center justify-center gap-0.5 transition-all duration-200 active:scale-[0.88]"
                style={{
                  width: 48,
                  minWidth: 48,
                  height: 48,
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute -top-0.5 w-8 h-1 rounded-full"
                    style={{
                      background: "hsl(142, 100%, 50%)",
                      boxShadow: "0 2px 12px -2px hsla(142, 100%, 50%, 0.55)",
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}

                <Icon
                  className={`shrink-0 transition-all duration-200 ${
                    isActive ? "text-primary" : "text-muted-foreground/45"
                  }`}
                  style={{ width: 20, height: 20 }}
                  strokeWidth={isActive ? 2.3 : 1.6}
                />
                <span
                  className={`text-[9px] font-semibold transition-all duration-200 ${
                    isActive ? "text-primary" : "text-muted-foreground/35"
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </motion.div>
      </div>
    </nav>
  );
});
