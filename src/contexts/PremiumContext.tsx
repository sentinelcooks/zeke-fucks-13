import { Capacitor } from "@capacitor/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  addCustomerInfoListener,
  ENTITLEMENT_ID,
  fetchCustomerInfo,
  hasActivePremium,
  identifyRevenueCatUser,
} from "@/lib/revenuecat";
import { premiumRequestHeaders } from "@/lib/premiumRequestHeaders";

export type PremiumStatus = "loading" | "active" | "inactive" | "error";

type PremiumContextValue = {
  status: PremiumStatus;
  isPremium: boolean;
  hasLifetimeAccess: boolean;
  accessSource: string | null;
  accessType: string | null;
  accessExpiresAt: string | null;
  hasCheckedPremium: boolean;
  initialLoading: boolean;
  isRefreshing: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: (reason?: string) => Promise<PremiumStatus>;
};

const PremiumContext = createContext<PremiumContextValue>({
  status: "loading",
  isPremium: false,
  hasLifetimeAccess: false,
  accessSource: null,
  accessType: null,
  accessExpiresAt: null,
  hasCheckedPremium: false,
  initialLoading: true,
  isRefreshing: false,
  isLoading: true,
  errorMessage: null,
  refresh: async () => "error",
});

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [status, setStatus] = useState<PremiumStatus>("loading");
  const [hasLifetimeAccess, setHasLifetimeAccess] = useState(false);
  const [accessSource, setAccessSource] = useState<string | null>(null);
  const [accessType, setAccessType] = useState<string | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState<string | null>(null);
  const [hasCheckedPremium, setHasCheckedPremium] = useState(false);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const removeListenerRef = useRef<(() => void) | null>(null);
  const refreshInFlightRef = useRef<Promise<PremiumStatus> | null>(null);

  const refresh = useCallback(async (reason = "manual"): Promise<PremiumStatus> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const run = (async () => {
      if (authLoading) return "loading" as PremiumStatus;
      if (!isAuthenticated || !user) {
        setStatus("inactive");
        setHasLifetimeAccess(false);
        setAccessSource(null);
        setAccessType(null);
        setAccessExpiresAt(null);
        setHasCheckedPremium(true);
        setCheckedUserId(null);
        setErrorMessage(null);
        return "inactive" as PremiumStatus;
      }

      setIsRefreshing(true);
      setErrorMessage(null);

      try {
        let nativeActive: boolean | null = null;
        if (Capacitor.isNativePlatform()) {
          console.info("[premium] RevenueCat identify/sync started", { reason });
          const identifiedInfo = await identifyRevenueCatUser(user.id);
          const info = identifiedInfo ?? await fetchCustomerInfo();
          nativeActive = hasActivePremium(info);
          console.info("[premium] CustomerInfo fetched", {
            premiumActive: nativeActive,
            entitlement: ENTITLEMENT_ID,
          });
        }

        const { data, error } = await supabase.functions.invoke("revenuecat-entitlements", {
          body: { reason },
          headers: await premiumRequestHeaders(),
        });

        if (error) {
          console.error("Premium entitlement check failed:", error);
          setStatus("error");
          setHasLifetimeAccess(false);
          setAccessSource(null);
          setAccessType(null);
          setAccessExpiresAt(null);
          setHasCheckedPremium(true);
          setCheckedUserId(user.id);
          setErrorMessage("Network error while checking subscription.");
          return "error" as PremiumStatus;
        }

        const active = data?.status === "active" || data?.isPremium === true || data?.isSubscribed === true;
        const lifetimeAccess = data?.lifetimeAccess === true;
        const source = typeof data?.accessSource === "string" ? data.accessSource : null;
        const type = typeof data?.accessType === "string" ? data.accessType : null;
        const expiresAt = typeof data?.expiresAt === "string" ? data.expiresAt : null;
        console.info("[premium] Supabase subscription cache synced", {
          status: data?.status ?? "unknown",
          premiumActive: active,
        });
        if (active) {
          setHasLifetimeAccess(lifetimeAccess);
          setAccessSource(source);
          setAccessType(type);
          setAccessExpiresAt(expiresAt);
          setStatus("active");
          setHasCheckedPremium(true);
          setCheckedUserId(user.id);
          console.info("[premium] user allowed into premium app");
          return "active" as PremiumStatus;
        }

        setHasLifetimeAccess(false);
        setAccessSource(null);
        setAccessType(null);
        setAccessExpiresAt(null);
        setStatus("inactive");
        setHasCheckedPremium(true);
        setCheckedUserId(user.id);
        console.info("[premium] user locked because entitlement inactive", {
          nativePremiumActive: nativeActive,
        });
        return "inactive" as PremiumStatus;
      } catch (err) {
        console.error("Premium refresh failed:", err);
        setStatus("error");
        setHasLifetimeAccess(false);
        setAccessSource(null);
        setAccessType(null);
        setAccessExpiresAt(null);
        setHasCheckedPremium(true);
        setCheckedUserId(user.id);
        setErrorMessage("Network error while checking subscription.");
        return "error" as PremiumStatus;
      } finally {
        setIsRefreshing(false);
      }
    })();

    refreshInFlightRef.current = run;
    try {
      return await run;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [authLoading, isAuthenticated, user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh("auth_state");
  }, [authLoading, refresh, user?.id]);

  useEffect(() => {
    let cancelled = false;

    if (!Capacitor.isNativePlatform()) return;

    addCustomerInfoListener((info) => {
      if (cancelled) return;
      const nativeActive = hasActivePremium(info);
      console.info("[premium] CustomerInfo listener update", {
        premiumActive: nativeActive,
        entitlement: ENTITLEMENT_ID,
      });
      void refresh("customer_info_listener");
    })
      .then((remove) => {
        if (cancelled) {
          remove();
          return;
        }
        removeListenerRef.current = remove;
      })
      .catch((err) => {
        console.error("Premium listener attach failed:", err);
      });

    return () => {
      cancelled = true;
      removeListenerRef.current?.();
      removeListenerRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void refresh("app_resume");
      }).then((handle) => {
        remove = () => handle.remove();
      });
    });
    return () => remove?.();
  }, [refresh]);

  const currentUserId = isAuthenticated && user ? user.id : null;
  const hasKnownPremiumState = !currentUserId
    ? !authLoading
    : hasCheckedPremium && checkedUserId === currentUserId;
  const initialLoading = authLoading || !hasKnownPremiumState;
  const visibleStatus: PremiumStatus = initialLoading
    ? "loading"
    : currentUserId
      ? status
      : "inactive";

  const value = useMemo<PremiumContextValue>(() => ({
    status: visibleStatus,
    isPremium: visibleStatus === "active",
    hasLifetimeAccess,
    accessSource,
    accessType,
    accessExpiresAt,
    hasCheckedPremium: hasKnownPremiumState,
    initialLoading,
    isRefreshing: isRefreshing && hasKnownPremiumState,
    isLoading: initialLoading,
    errorMessage,
    refresh,
  }), [accessExpiresAt, accessSource, accessType, errorMessage, hasKnownPremiumState, hasLifetimeAccess, initialLoading, isRefreshing, refresh, visibleStatus]);

  return (
    <PremiumContext.Provider value={value}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  return useContext(PremiumContext);
}

export { ENTITLEMENT_ID };
