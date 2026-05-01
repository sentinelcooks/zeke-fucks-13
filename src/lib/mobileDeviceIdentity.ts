// Persistent mobile device identity for phone-only account-sharing protection.
//
// Production hardening note: this currently uses Capacitor Preferences on native
// (NSUserDefaults / SharedPreferences) which survives app restarts but is wiped
// on uninstall. For stronger persistence across reinstalls on the same device,
// migrate to a Keychain-backed secure storage plugin (e.g.
// @aparajita/capacitor-secure-storage) and read/write the same key.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const STORAGE_KEY = "sentinel_mobile_device_id";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (very old WebViews) — RFC4122 v4-ish via getRandomValues.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readStored(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    return value ?? null;
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeStored(value: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: STORAGE_KEY, value });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // best-effort; ephemeral session is acceptable on web (gate is no-op there)
  }
}

export async function getOrCreateMobileDeviceId(): Promise<string> {
  const existing = await readStored();
  if (existing && existing.length >= 16) return existing;
  const fresh = generateUuid();
  await writeStored(fresh);
  return fresh;
}

export function getMobilePlatform(): "ios" | "android" | "web" {
  const p = Capacitor.getPlatform();
  if (p === "ios" || p === "android") return p;
  return "web";
}

export function getMobileDeviceLabel(): string {
  const platform = getMobilePlatform();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  if (platform === "ios") {
    if (/iPad/i.test(ua)) return "iPad";
    if (/iPhone/i.test(ua)) return "iPhone";
    return "iOS Device";
  }
  if (platform === "android") {
    return "Android Device";
  }
  return "Web";
}
