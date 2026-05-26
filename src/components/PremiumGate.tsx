import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePremium } from "@/contexts/PremiumContext";

function CheckingSubscription() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 h-9 w-9 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      <p className="text-sm font-semibold text-foreground">Checking subscription...</p>
    </div>
  );
}

function LockedSubscription({ kind }: { kind: "inactive" | "error" }) {
  const navigate = useNavigate();
  const { refresh, errorMessage } = usePremium();
  const isError = kind === "error";
  const Icon = isError ? WifiOff : Lock;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-5 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-bold text-foreground">
          {isError ? "Network error while checking subscription" : "Subscription required"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isError
            ? errorMessage || "Sentinel Premium could not be verified. Premium features stay locked until your subscription is confirmed active."
            : "Your subscription has ended. Renew Sentinel Premium to continue accessing Today's Edge, Picks, and AI analysis."}
        </p>
        <div className="mt-5 space-y-2">
          <Button onClick={() => navigate("/paywall")} className="w-full">
            Renew Sentinel Premium
          </Button>
          <Button onClick={() => void refresh("locked_screen_retry")} variant="outline" className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Check again
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <a href="mailto:support@sentinelprops.app?subject=Sentinel%20Premium%20support">
              Contact support
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PremiumGate({ children }: { children: ReactNode }) {
  const { status, refresh } = usePremium();

  useEffect(() => {
    void refresh("premium_gate");
  }, [refresh]);

  if (status === "loading") return <CheckingSubscription />;
  if (status === "active") return <>{children}</>;
  if (status === "error") return <LockedSubscription kind="error" />;
  return <LockedSubscription kind="inactive" />;
}
