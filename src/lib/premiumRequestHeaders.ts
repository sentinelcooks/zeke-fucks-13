import { getOrCreateMobileDeviceId } from "@/lib/mobileDeviceIdentity";

export async function premiumRequestHeaders(): Promise<Record<string, string>> {
  return {
    "x-sentinel-device-id": await getOrCreateMobileDeviceId(),
  };
}
