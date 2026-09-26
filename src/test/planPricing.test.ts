import { describe, expect, it } from "vitest";
import { planCopy } from "@/lib/planPricing";

describe("planCopy", () => {
  const usd = { weekly: 9.99, monthly: 39.99, yearly: 219.99 };

  it("derives per-period prices from the actual prices", () => {
    const c = planCopy(usd, "USD", "en-US");
    expect(c.monthly.subtext).toBe("$1.31/day");      // 39.99 / 30.4375 days
    expect(c.yearly.subtext).toBe("$18.33/month");    // 219.99 / 12
  });

  it("states savings that are true (floored, never rounded up)", () => {
    const c = planCopy(usd, "USD", "en-US");
    expect(c.monthly.saving).toBe("Save 7% vs weekly");     // 9.99 × 52/12 = 43.29 per month
    expect(c.yearly.saving).toBe("Save 54% vs monthly");    // 39.99 × 12 = 479.88 per year
    expect(c.yearly.extraLine).toBe("6 months free vs monthly");
  });

  it("formats other currencies with the store's currency code", () => {
    const c = planCopy({ weekly: 9.99, monthly: 39.99, yearly: 219.99 }, "EUR", "en-US");
    expect(c.monthly.subtext).toBe("€1.31/day");
    expect(c.yearly.subtext).toBe("€18.33/month");
  });

  it("omits savings when a plan is not actually cheaper", () => {
    const c = planCopy({ weekly: 5, monthly: 40, yearly: 600 }, "USD", "en-US");
    expect(c.monthly.saving).toBeUndefined();
    expect(c.yearly.saving).toBeUndefined();
    expect(c.yearly.extraLine).toBeUndefined();
  });

  it("uses the singular for exactly one free month", () => {
    const c = planCopy({ monthly: 10, yearly: 110 }, "USD", "en-US");
    expect(c.yearly.extraLine).toBe("1 month free vs monthly");
  });

  it("skips comparisons when a price is missing", () => {
    const c = planCopy({ monthly: 39.99 }, "USD", "en-US");
    expect(c.monthly.saving).toBeUndefined();
    expect(c.yearly.subtext).toBeUndefined();
  });

  it("falls back to USD when the currency code is not valid", () => {
    const c = planCopy(usd, "$", "en-US");
    expect(c.yearly.subtext).toBe("$18.33/month");
  });
});
