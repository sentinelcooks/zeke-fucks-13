import { useState, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePremium } from "@/contexts/PremiumContext";

interface SubscriptionState {
  isSubscribed: boolean;
  isLoading: boolean;
  entitlements: Record<string, boolean>;
  activeSubscriptions: string[];
  checkEntitlements: () => Promise<void>;
}

export function useSubscription(): SubscriptionState {
  const { user, isAuthenticated } = useAuth();
  const premium = usePremium();
  const native = Capacitor.isNativePlatform();

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [entitlements, setEntitlements] = useState<Record<string, boolean>>({});
  const [activeSubscriptions, setActiveSubscriptions] = useState<string[]>([]);

  const checkEntitlements = useCallback(async () => {
    if (native) {
      // On native, defer to PremiumContext (StoreKit + listener-driven, authoritative).
      await premium.refresh();
      setIsSubscribed(premium.isPremium);
      setEntitlements(premium.isPremium ? { "Sentinel Premium": true } : {});
      setIsLoading(false);
      return;
    }

    if (!isAuthenticated || !user) {
      setIsSubscribed(false);
      setEntitlements({});
      setActiveSubscriptions([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const { data, error } = await supabase.functions.invoke(
        "revenuecat-entitlements"
      );
      if (error) {
        console.error("Entitlement check failed:", error);
        setIsSubscribed(false);
      } else {
        setIsSubscribed(data.isSubscribed ?? false);
        setEntitlements(data.entitlements ?? {});
        setActiveSubscriptions(data.activeSubscriptions ?? []);
      }
    } catch (err) {
      console.error("Subscription check error:", err);
      setIsSubscribed(false);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user, native, premium]);

  useEffect(() => {
    if (native) {
      setIsSubscribed(premium.isPremium);
      setEntitlements(premium.isPremium ? { "Sentinel Premium": true } : {});
      setIsLoading(premium.isLoading);
      return;
    }
    checkEntitlements();
  }, [native, premium.isPremium, premium.isLoading, checkEntitlements]);

  return { isSubscribed, isLoading, entitlements, activeSubscriptions, checkEntitlements };
}
