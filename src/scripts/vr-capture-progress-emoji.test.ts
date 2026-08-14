import { describe, expect, it } from "vitest";

import { captureProgressEmoji } from "./vr-capture-engine";

describe("captureProgressEmoji", () => {
  it("maps diff to warning, new to sparkle, error to blocked", () => {
    expect(captureProgressEmoji("diff")).toBe("⚠️");
    expect(captureProgressEmoji("new")).toBe("❇️");
    expect(captureProgressEmoji("error")).toBe("🚫");
  });

  it("maps match to success (baseline validée)", () => {
    expect(captureProgressEmoji("match")).toBe("✅");
  });

  it("maps ignored to flag (ignore-vr)", () => {
    expect(captureProgressEmoji("ignored")).toBe("🏳️");
  });
});
