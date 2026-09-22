import { getMobilePlatform } from "@/lib/mobileDeviceIdentity";

/**
 * Appends the calling platform to a premium Edge Function path.
 *
 * `requiresRegisteredDevice()` in `_shared/premium-access.ts` reads
 * `client_platform` off the request URL and demands a registered device for
 * anything that is not "web". A request that omits the parameter reads as
 * `undefined !== "web"` — so it is treated as a mobile client, fails the
 * `user_devices` lookup a browser can never satisfy, and comes back 403.
 *
 * That is why every premium call from the web app has to carry it. It is not a
 * bypass: on iOS and Android `getMobilePlatform()` returns the real platform
 * and the device check still runs.
 */
export function withClientPlatform(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}client_platform=${encodeURIComponent(getMobilePlatform())}`;
}
