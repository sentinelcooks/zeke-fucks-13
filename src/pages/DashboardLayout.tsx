import { useEffect, useRef, useState, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { FloatingParlaySlip } from "@/components/FloatingParlaySlip";
import AppFooter from "@/components/AppFooter";
import { RateAppDialog } from "@/components/RateAppDialog";
import { useSubscription } from "@/hooks/useSubscription";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { UsernamePromptDialog } from "@/components/UsernamePromptDialog";
import { useAuth } from "@/contexts/AuthContext";

const routeTitles: Record<string, string> = {
  "/dashboard/home": "Today",
  "/dashboard/games": "Games",
  "/dashboard/analyze": "Analyze",
  "/dashboard/moneyline": "Lines",
  "/dashboard/picks": "Picks",
  "/dashboard/free-props": "Free Props",
  "/dashboard/free-picks": "Picks",
  "/dashboard/tracker": "Tracker",
  "/dashboard/parlay": "Parlay Builder",
  "/dashboard/settings": "Settings",
  "/dashboard/arbitrage": "Arbitrage",
  "/dashboard/ufc": "UFC Analysis",
  "/dashboard/trends": "Trends",
  "/dashboard/legal": "Legal",
};

const DashboardLayout = () => {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { isSubscribed, isLoading } = useSubscription();
  const { user, profile, isLoading: authLoading } = useAuth();
  const [showRate, setShowRate] = useState(false);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const profileDisplayName = profile?.display_name?.trim() || "";
  const metaDisplayName = ((user?.user_metadata as { display_name?: string } | undefined)?.display_name || "").trim();
  const needsUsername =
    !authLoading && !!user && !!profile && !profileDisplayName && !metaDisplayName && !usernameSaved;

  const title = routeTitles[location.pathname] || "Sentinel";
  const displayName = profileDisplayName || metaDisplayName || user?.email || "";
  const initials = displayName
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  // Update browser tab title
  useEffect(() => {
    document.title = title === "Today" ? "Sentinel" : `${title} – Sentinel`;
  }, [title]);

  // Tab-switch scroll restore
  const scrollSnapshot = useRef<{ pathname: string; scrollTop: number; timestamp: number } | null>(null);
  const skipNextScrollReset = useRef(false);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        scrollSnapshot.current = {
          pathname: location.pathname,
          scrollTop: mainRef.current?.scrollTop ?? 0,
          timestamp: Date.now(),
        };
      } else if (document.visibilityState === "visible" && scrollSnapshot.current) {
        const snap = scrollSnapshot.current;
        if (
          snap.pathname === location.pathname &&
          Date.now() - snap.timestamp < 10_000
        ) {
          skipNextScrollReset.current = true;
          requestAnimationFrame(() => {
            mainRef.current?.scrollTo(0, snap.scrollTop);
          });
        }
        scrollSnapshot.current = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [location.pathname]);

  useEffect(() => {
    if (skipNextScrollReset.current) {
      skipNextScrollReset.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (isLoading || !isSubscribed) return;
    if (localStorage.getItem("sentinel_rate_dismissed")) return;

    const now = Date.now();
    const stored = localStorage.getItem("sentinel_subscribed_at");
    if (!stored) {
      localStorage.setItem("sentinel_subscribed_at", String(now));
      return;
    }

    if (now - Number(stored) >= 24 * 60 * 60 * 1000) {
      setShowRate(true);
    }
  }, [isSubscribed, isLoading]);

  return (
    <div className="min-h-screen flex flex-col w-full min-w-0 bg-background max-w-[430px] mx-auto relative overflow-x-hidden">
      {/* Pinned header */}
      <MobileHeader title={title} initials={initials} />

      {/* Main content (bottom padding clears the floating tab bar) */}
      <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden pb-28">
        <Outlet />
        <AppFooter />
      </main>
      
      {/* Floating parlay slip */}
      <FloatingParlaySlip />
      
      {/* Floating glass tab bar */}
      <BottomTabBar />
      <RateAppDialog open={showRate} onClose={() => setShowRate(false)} />
      <UsernamePromptDialog open={needsUsername} onSaved={() => setUsernameSaved(true)} />
    </div>
  );
};

export default DashboardLayout;
