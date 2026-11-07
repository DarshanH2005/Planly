import { describe, it, expect } from "vitest";
import { ok, okMutation, fail } from "../../src/lib/validation/result.js";

describe("Result Envelope Contract (Spec §13)", () => {
  it("creates a successful domain result with data only", () => {
    const res = ok({ foo: "bar" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ foo: "bar" });
    }
  });

  it("creates a successful mutation result with data, version and requestId", () => {
    const res = okMutation({ foo: "bar" }, 2, "req-123");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ foo: "bar" });
      expect(res.version).toBe(2);
      expect(res.requestId).toBe("req-123");
    }
  });

  it("creates an error result with correct ErrorCode and message", () => {
    const res = fail("FORBIDDEN", "Unauthorized owner");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
      expect(res.message).toBe("Unauthorized owner");
    }
  });

  it("supports fieldErrors and currentVersion in failure", () => {
    const res = fail("VALIDATION_ERROR", "Invalid input", {
      fieldErrors: { email: "Required" },
      currentVersion: 3,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fieldErrors?.email).toBe("Required");
      expect(res.currentVersion).toBe(3);
    }
  });
});
