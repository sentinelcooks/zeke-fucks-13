import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";
import { RevenueCatUI, PAYWALL_RESULT } from "@revenuecat/purchases-capacitor-ui";

const API_KEY = "appl_wmSrROmrGLyeBmcpgxydApKAxLl";
const ENTITLEMENT_ID = "premium";

// 🔧 Initialize RevenueCat
export async function initRevenueCat() {
  if (!Capacitor.isNativePlatform()) return;

  await Purchases.configure({ apiKey: API_KEY });
}

// 💰 Custom purchase (uses your UI plan selection)
export async function purchasePlan(plan: "weekly" | "monthly" | "yearly") {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("RevenueCat purchases only work inside the iOS app.");
  }

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

  return Boolean(
    purchaseResult.customerInfo.entitlements.active[ENTITLEMENT_ID]
  );
}

// 🔄 Restore purchases
export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("RevenueCat restore only works inside the iOS app.");
  }

  const restoreResult = await Purchases.restorePurchases();

  return Boolean(
    restoreResult.customerInfo.entitlements.active[ENTITLEMENT_ID]
  );
}

// 🚀 Hosted RevenueCat Paywall (what your screen is using now)
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