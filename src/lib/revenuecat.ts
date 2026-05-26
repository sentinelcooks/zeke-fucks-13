import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  type CustomerInfo,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import { RevenueCatUI, PAYWALL_RESULT } from "@revenuecat/purchases-capacitor-ui";

const API_KEY = "appl_wmSrROmrGLyeBmcpgxydApKAxLl";
export const ENTITLEMENT_ID = "premium";

let configured = false;

export async function initRevenueCat() {
  if (!Capacitor.isNativePlatform()) return;
  if (configured) return;
  await Purchases.configure({ apiKey: API_KEY });
  configured = true;
}

export async function loginRevenueCatUser(userId: string) {
  if (!Capacitor.isNativePlatform()) return;
  await initRevenueCat();
  await Purchases.logIn({ appUserID: userId });
}

export async function identifyRevenueCatUser(userId: string): Promise<CustomerInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  await initRevenueCat();

  const { appUserID } = await Purchases.getAppUserID();
  const wasAnonymous = appUserID.startsWith("$RCAnonymousID:");
  if (appUserID === userId) {
    console.info("[revenuecat] already identified for Supabase user");
    return fetchCustomerInfo();
  }

  console.info("[revenuecat] identify started", { wasAnonymous });
  const result = await Purchases.logIn({ appUserID: userId });
  console.info("[revenuecat] identify succeeded", {
    created: result.created,
    premiumActive: hasActivePremium(result.customerInfo),
  });
  return result.customerInfo;
}

export async function logoutRevenueCatUser() {
  if (!Capacitor.isNativePlatform()) return;
  await initRevenueCat();
  await Purchases.logOut();
}

export async function fetchCustomerInfo(): Promise<CustomerInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  await initRevenueCat();
  const { customerInfo } = await Purchases.getCustomerInfo();
  return customerInfo;
}

export function hasActivePremium(customerInfo: CustomerInfo | null | undefined): boolean {
  if (!customerInfo) return false;
  return Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
}

export async function addCustomerInfoListener(
  cb: (info: CustomerInfo) => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  await initRevenueCat();
  const handle = await Purchases.addCustomerInfoUpdateListener(cb);
  return () => {
    try {
      // SDK v13 returns a callback id usable with removeCustomerInfoUpdateListener
      // @ts-expect-error — runtime API exists; types vary by SDK minor
      Purchases.removeCustomerInfoUpdateListener?.(handle);
    } catch {
      // no-op
    }
  };
}

export async function getCurrentOfferingPackages(): Promise<{
  weekly?: PurchasesPackage;
  monthly?: PurchasesPackage;
  yearly?: PurchasesPackage;
}> {
  if (!Capacitor.isNativePlatform()) return {};
  await initRevenueCat();
  const offeringsResult = await Purchases.getOfferings();
  const currentOffering = offeringsResult.current;
  if (!currentOffering) return {};
  const find = (id: string) =>
    currentOffering.availablePackages.find((p) => p.identifier === id);
  return {
    weekly: find("$rc_weekly"),
    monthly: find("$rc_monthly"),
    yearly: find("$rc_annual"),
  };
}

export async function purchasePlan(plan: "weekly" | "monthly" | "yearly") {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("RevenueCat purchases only work inside the iOS app.");
  }
  await initRevenueCat();

  const offeringsResult = await Purchases.getOfferings();
  const currentOffering = offeringsResult.current;

  if (!currentOffering) {
    throw new Error("No current RevenueCat offering found.");
  }

  const packageIdentifier =
    plan === "weekly"
      ? "$rc_weekly"
      : plan === "monthly"
      ? "$rc_monthly"
      : "$rc_annual";

  const selectedPackage = currentOffering.availablePackages.find(
    (pkg) => pkg.identifier === packageIdentifier
  );

  if (!selectedPackage) {
    throw new Error(`No package found for ${plan}`);
  }

  const purchaseResult = await Purchases.purchasePackage({
    aPackage: selectedPackage,
  });

  console.info("[revenuecat] purchase completed", {
    plan,
    premiumActive: hasActivePremium(purchaseResult.customerInfo),
  });
  return hasActivePremium(purchaseResult.customerInfo);
}

export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("RevenueCat restore only works inside the iOS app.");
  }
  await initRevenueCat();

  const restoreResult = await Purchases.restorePurchases();
  console.info("[revenuecat] restore completed", {
    premiumActive: hasActivePremium(restoreResult.customerInfo),
  });
  return hasActivePremium(restoreResult.customerInfo);
}

const APPLE_MANAGE_URL = "https://apps.apple.com/account/subscriptions";

export async function getSubscriptionManagementURL(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return APPLE_MANAGE_URL;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfo?.managementURL ?? APPLE_MANAGE_URL;
  } catch {
    return APPLE_MANAGE_URL;
  }
}

export async function openRevenueCatPaywall(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Must run on iOS device");
  }

  const { result } = await RevenueCatUI.presentPaywall();

  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
    case PAYWALL_RESULT.RESTORED:
      return true;

    default:
      return false;
  }
}
