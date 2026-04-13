import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { FloatingParlaySlip } from "@/components/FloatingParlaySlip";
import AppFooter from "@/components/AppFooter";
import { RateAppDialog } from "@/components/RateAppDialog";
import { useSubscription } from "@/hooks/useSubscription";

const DashboardLayout = () => {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { isSubscribed, isLoading } = useSubscription();
  const [showRate, setShowRate] = useState(false);

  useEffect(() => {
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
      {/* Ambient background glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-[0.03] pointer-events-none" style={{ background: 'radial-gradient(circle, hsl(250 76% 62%), transparent 70%)' }} />
      
      {/* Main content */}
      <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        <Outlet />
        <AppFooter />
      </main>
      
      {/* Floating parlay slip */}
      <FloatingParlaySlip />
      
      {/* Vision UI style bottom tabs */}
      <BottomTabBar />
      <RateAppDialog open={showRate} onClose={() => setShowRate(false)} />
    </div>
  );
};

export default DashboardLayout;
