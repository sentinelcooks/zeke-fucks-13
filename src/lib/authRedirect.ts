import { Capacitor } from "@capacitor/core";

export function getAuthRedirectUrl(): string {
  if (Capacitor.isNativePlatform()) {
    return "sentinel://auth/callback";
  }
  return `${window.location.origin}/auth/callback`;
}
