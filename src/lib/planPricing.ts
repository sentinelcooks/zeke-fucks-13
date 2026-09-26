/**
 * Paywall copy derived from the real plan prices, so per-period prices and
 * savings claims always match what the App Store charges (Guideline 3.1.2).
 * Savings are floored so we never overstate them.
 */

export interface PlanPrices {
  weekly?: number;
  monthly?: number;
  yearly?: number;
}

export interface PlanCopy {
  monthly: { subtext?: string; saving?: string };
  yearly: { subtext?: string; saving?: string; extraLine?: string };
}

const DAYS_PER_MONTH = 365.25 / 12; // 30.4375
const WEEKS_PER_MONTH = 52 / 12;

function currencyFormatter(currency: string, locale?: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    // RevenueCat can return a bare currency symbol when it cannot resolve the ISO code.
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

const isPrice = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function planCopy(prices: PlanPrices, currency = "USD", locale?: string): PlanCopy {
  const fmt = currencyFormatter(currency, locale);
  const { weekly, monthly, yearly } = prices;
  const copy: PlanCopy = { monthly: {}, yearly: {} };

  if (isPrice(monthly)) {
    copy.monthly.subtext = `${fmt.format(monthly / DAYS_PER_MONTH)}/day`;
    if (isPrice(weekly)) {
      const pct = Math.floor((1 - monthly / (weekly * WEEKS_PER_MONTH)) * 100);
      if (pct >= 1) copy.monthly.saving = `Save ${pct}% vs weekly`;
    }
  }

  if (isPrice(yearly)) {
    copy.yearly.subtext = `${fmt.format(yearly / 12)}/month`;
    if (isPrice(monthly)) {
      const pct = Math.floor((1 - yearly / (monthly * 12)) * 100);
      if (pct >= 1) copy.yearly.saving = `Save ${pct}% vs monthly`;
      const freeMonths = Math.floor((monthly * 12 - yearly) / monthly);
      if (freeMonths >= 1) copy.yearly.extraLine = `${freeMonths} ${freeMonths === 1 ? "month" : "months"} free vs monthly`;
    }
  }

  return copy;
}
