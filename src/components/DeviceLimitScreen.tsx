import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useDeviceVerification } from "@/contexts/DeviceVerificationContext";

function formatLastSeen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function DeviceLimitScreen() {
  const { devices, revokeOthersAndContinue, errorMessage, recheck, status } = useDeviceVerification();
  const { signOut } = useAuth();
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const isVerificationError = status === "error";

  const handleRemove = async () => {
    setWorking(true);
    setLocalError(null);
    try {
      await revokeOthersAndContinue();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to remove old device");
    } finally {
      setWorking(false);
    }
  };

  const handleRetry = async () => {
    setWorking(true);
    setLocalError(null);
    try {
      await recheck();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to verify this device");
    } finally {
      setWorking(false);
    }
  };

  const handleSignOut = async () => {
    setWorking(true);
    try {
      await signOut();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/60 bg-card p-6 shadow-xl">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold leading-tight">
            {isVerificationError ? "Device verification unavailable" : "Account already active on another device"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isVerificationError
              ? "We couldn't verify this device. Check your connection and try again, or contact support."
              : "Too many devices are using this account. Please log out on another device or contact support."}
          </p>
        </div>

        {!isVerificationError && devices.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{d.device_label ?? "Unknown device"}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.platform} - last seen {formatLastSeen(d.last_seen)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(localError || errorMessage) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {localError ?? errorMessage}
          </div>
        )}

        <div className="space-y-2">
          {isVerificationError ? (
            <Button onClick={handleRetry} disabled={working} className="w-full">
              {working ? "Working..." : "Try again"}
            </Button>
          ) : (
            <Button onClick={handleRemove} disabled={working} className="w-full">
              {working ? "Working..." : "Remove old device and continue"}
            </Button>
          )}
          <Button
            onClick={handleSignOut}
            disabled={working}
            variant="outline"
            className="w-full"
          >
            Sign out
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <a href="mailto:support@sentinelprops.app?subject=Sentinel%20device%20issue">
              Contact support
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
