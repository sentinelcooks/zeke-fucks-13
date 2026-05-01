import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

// Capacitor push lifecycle. The @capacitor/push-notifications plugin is dynamically
// imported only on native iOS so the web bundle never tries to load the native bridge.

export type PushRegistrationStatus =
  | "not-requested"
  | "granted"
  | "denied"
  | "error";

export function isPushSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

async function saveTokenToSupabase(token: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("mobile_push_tokens")
    .upsert(
      {
        user_id: user.id,
        platform: "ios",
        device_token: token,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,device_token" }
    );
}

export async function checkPushPermission(): Promise<PushRegistrationStatus> {
  if (!isPushSupported()) return "not-requested";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    if (status.receive === "granted") return "granted";
    if (status.receive === "denied") return "denied";
    return "not-requested";
  } catch {
    return "error";
  }
}

/**
 * Triggers the iOS "Allow Notifications?" system dialog on first call.
 * Must be called from a user gesture (button tap).
 */
export async function requestAndRegisterPush(): Promise<PushRegistrationStatus> {
  if (!isPushSupported()) return "not-requested";

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    const current = await PushNotifications.checkPermissions();
    if (current.receive === "denied") return "denied";

    const result = await PushNotifications.requestPermissions();
    if (result.receive !== "granted") return "denied";

    // Triggers didRegisterForRemoteNotificationsWithDeviceToken on iOS,
    // which fires the 'registration' event handled in setupPushListeners.
    await PushNotifications.register();

    return "granted";
  } catch (e) {
    console.error("[push] requestAndRegisterPush failed:", e);
    return "error";
  }
}

/**
 * Wire up registration and incoming-notification listeners. Call once after
 * the user is authenticated. Returns a cleanup function.
 */
export async function setupPushListeners(): Promise<() => void> {
  if (!isPushSupported()) return () => {};

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    await PushNotifications.addListener("registration", async (token) => {
      console.log("[push] APNs token received:", token.value.slice(0, 8) + "...");
      await saveTokenToSupabase(token.value);
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.error("[push] Registration error:", err.error);
    });

    await PushNotifications.addListener("pushNotificationReceived", (notification) => {
      // Foreground push — show a toast since the system banner is suppressed
      import("sonner").then(({ toast }) => {
        toast.info(notification.title ?? "Sentinel", {
          description: notification.body,
        });
      });
    });

    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      // User tapped the notification. Deep-link data lives in action.notification.data
      // (e.g. { screen: 'games', game_id: '...', sport_key: '...' })
      console.log("[push] Notification tapped:", action.notification.data);
    });

    return async () => {
      try {
        await PushNotifications.removeAllListeners();
      } catch {
        /* noop */
      }
    };
  } catch (e) {
    console.error("[push] setupPushListeners failed:", e);
    return () => {};
  }
}

/**
 * Soft-disables this user's iOS tokens (sets enabled=false) so the cron
 * stops targeting them, and tells Capacitor to deregister from APNs.
 * Re-enabling Settings notifications will re-register and flip these back on.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("mobile_push_tokens")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("platform", "ios");
    }
    await PushNotifications.unregister();
  } catch (e) {
    console.error("[push] unregisterPushToken failed:", e);
  }
}
