import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ value: "web" as "web" | "ios" | "android" }));

vi.mock("@/lib/mobileDeviceIdentity", () => ({
  getMobilePlatform: () => platform.value,
}));

import { withClientPlatform } from "@/lib/edgeFunctionPath";

describe("withClientPlatform", () => {
  // Omitting this parameter is what broke every player prop on web: the premium
  // gate reads it as "not web", demands a registered device, and returns 403.
  it("marks a browser request as web so the device check is skipped", () => {
    platform.value = "web";
    expect(withClientPlatform("nba-api/analyze")).toBe("nba-api/analyze?client_platform=web");
  });

  it("still reports the real platform on mobile, where the device check applies", () => {
    platform.value = "ios";
    expect(withClientPlatform("nba-api/analyze")).toBe("nba-api/analyze?client_platform=ios");
    platform.value = "android";
    expect(withClientPlatform("correlated-props")).toBe("correlated-props?client_platform=android");
  });

  it("appends to a path that already carries a query string", () => {
    platform.value = "web";
    expect(withClientPlatform("nba-api/search?q=kwan&sport=mlb")).toBe(
      "nba-api/search?q=kwan&sport=mlb&client_platform=web",
    );
  });

  it("works on an absolute function URL", () => {
    platform.value = "web";
    expect(withClientPlatform("https://example.supabase.co/functions/v1/ufc-api/analyze")).toBe(
      "https://example.supabase.co/functions/v1/ufc-api/analyze?client_platform=web",
    );
  });
});
