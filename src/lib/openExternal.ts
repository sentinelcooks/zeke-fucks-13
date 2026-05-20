import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

/**
 * Open an external URL safely.
 *
 * On native (iOS/Android) we use Capacitor Browser (SFSafariViewController on
 * iOS) so the user stays in-app — Apple App Review rejects flows that punt to
 * the default external browser, especially for sign-in or paid content.
 * On web we fall back to a new tab with safe rel attributes.
 */
export async function openExternal(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url, presentationStyle: "popover" });
    return;
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) win.opener = null;
}
