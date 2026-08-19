import { describe, expect, it } from "vitest";
import { canWriteOutcome } from "../../supabase/functions/_shared/outcome_access";

describe("outcome ownership", () => {
  it("allows the service role", () => {
    expect(canWriteOutcome({ isServiceRole: true, authenticatedUserId: null, snapshotUserId: null })).toBe(true);
  });

  it("allows only the authenticated snapshot owner", () => {
    expect(canWriteOutcome({ isServiceRole: false, authenticatedUserId: "user-1", snapshotUserId: "user-1" })).toBe(true);
    expect(canWriteOutcome({ isServiceRole: false, authenticatedUserId: "user-2", snapshotUserId: "user-1" })).toBe(false);
    expect(canWriteOutcome({ isServiceRole: false, authenticatedUserId: null, snapshotUserId: "user-1" })).toBe(false);
  });
});
