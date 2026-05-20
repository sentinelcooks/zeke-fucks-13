import { Capacitor } from "@capacitor/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addCustomerInfoListener,
  fetchCustomerInfo,
  hasActivePremium,
} from "@/lib/revenuecat";

type PremiumContextValue = {
  isPremium: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const PremiumContext = createContext<PremiumContextValue>({
  isPremium: false,
  isLoading: true,
  refresh: async () => {},
});

export function PremiumProvider({ children }: { children: ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(Capacitor.isNativePlatform());
  const removeListenerRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setIsPremium(false);
      setIsLoading(false);
      return;
    }
    try {
      const info = await fetchCustomerInfo();
      setIsPremium(hasActivePremium(info));
    } catch (err) {
      console.error("PremiumContext refresh failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void refresh();

    if (Capacitor.isNativePlatform()) {
      addCustomerInfoListener((info) => {
        if (cancelled) return;
        setIsPremium(hasActivePremium(info));
        setIsLoading(false);
      })
        .then((remove) => {
          if (cancelled) {
            remove();
            return;
          }
          removeListenerRef.current = remove;
        })
        .catch((err) => {
          console.error("PremiumContext listener attach failed:", err);
        });
    }

    return () => {
      cancelled = true;
      removeListenerRef.current?.();
      removeListenerRef.current = null;
    };
  }, [refresh]);

  return (
    <PremiumContext.Provider value={{ isPremium, isLoading, refresh }}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  return useContext(PremiumContext);
}
