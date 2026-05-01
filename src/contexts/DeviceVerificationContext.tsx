import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  getOrCreateMobileDeviceId,
  getMobileDeviceLabel,
  getMobilePlatform,
} from "@/lib/mobileDeviceIdentity";

export interface KnownDevice {
  id: string;
  platform: string;
  device_label: string | null;
  first_seen: string;
  last_seen: string;
}

type Status = "idle" | "checking" | "allowed" | "blocked" | "error";

interface DeviceVerificationContextValue {
  status: Status;
  devices: KnownDevice[];
  deviceLimit: number;
  activeDeviceCount: number;
  errorMessage: string | null;
  recheck: () => Promise<void>;
  revokeOthersAndContinue: () => Promise<void>;
  revokeDevice: (deviceRowId: string) => Promise<void>;
}

const DeviceVerificationContext = createContext<DeviceVerificationContextValue | null>(null);

export function DeviceVerificationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [activeDeviceCount, setActiveDeviceCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastCheckedUser = useRef<string | null>(null);

  const verify = useCallback(async () => {
    // Web/desktop is not gated.
    if (!Capacitor.isNativePlatform()) {
      setStatus("allowed");
      return;
    }
    setStatus("checking");
    setErrorMessage(null);
    try {
      const deviceId = await getOrCreateMobileDeviceId();
      const platform = getMobilePlatform();
      const deviceLabel = getMobileDeviceLabel();
      const { data, error } = await supabase.functions.invoke("verify-phone-device", {
        body: { deviceId, platform, deviceLabel },
      });
      if (error) {
        setErrorMessage(error.message ?? "Verification failed");
        setStatus("error");
        return;
      }
      const payload = (data ?? {}) as {
        allowed?: boolean;
        reason?: string;
        deviceLimit?: number;
        activeDeviceCount?: number;
        devices?: KnownDevice[];
      };
      setDeviceLimit(payload.deviceLimit ?? 1);
      setActiveDeviceCount(payload.activeDeviceCount ?? 0);
      if (payload.allowed) {
        setDevices([]);
        setStatus("allowed");
      } else {
        setDevices(payload.devices ?? []);
        setStatus("blocked");
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Verification failed");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      lastCheckedUser.current = null;
      setStatus("idle");
      setDevices([]);
      return;
    }
    if (lastCheckedUser.current === user.id && status !== "idle") return;
    lastCheckedUser.current = user.id;
    void verify();
  }, [isAuthenticated, isLoading, user, verify, status]);

  const revokeOthersAndContinue = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    setStatus("checking");
    try {
      const deviceId = await getOrCreateMobileDeviceId();
      const { error } = await supabase.functions.invoke("manage-phone-devices", {
        body: { action: "revoke_all_except_current", deviceId },
      });
      if (error) {
        setErrorMessage(error.message ?? "Failed to revoke");
        setStatus("blocked");
        return;
      }
      await verify();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to revoke");
      setStatus("blocked");
    }
  }, [verify]);

  const revokeDevice = useCallback(
    async (deviceRowId: string) => {
      const { error } = await supabase.functions.invoke("manage-phone-devices", {
        body: { action: "revoke_device", deviceId: deviceRowId },
      });
      if (error) throw new Error(error.message ?? "Failed to revoke");
      await verify();
    },
    [verify]
  );

  return (
    <DeviceVerificationContext.Provider
      value={{
        status,
        devices,
        deviceLimit,
        activeDeviceCount,
        errorMessage,
        recheck: verify,
        revokeOthersAndContinue,
        revokeDevice,
      }}
    >
      {children}
    </DeviceVerificationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDeviceVerification() {
  const ctx = useContext(DeviceVerificationContext);
  if (!ctx) throw new Error("useDeviceVerification must be inside DeviceVerificationProvider");
  return ctx;
}
