import { describe, expect, it } from "vitest";

import type { VrConfig } from "../types/types";

import { createTestVrConfig } from "./test-helpers";
import {
  formatDiffConfirmedLog,
  formatDiffVerifyRetryLog,
  formatFlakeSuppressedLog,
  getDiffVerificationMaxAttempts,
  shouldRetryDiffVerification,
} from "./vr-diff-verify";

const configWithAttempts = (attempts: number): VrConfig =>
  createTestVrConfig({
    compare: {
      ...createTestVrConfig().compare,
      diffVerificationMaxAttempts: attempts,
    },
  });

describe("getDiffVerificationMaxAttempts", () => {
  it("returns configured attempts", () => {
    expect(getDiffVerificationMaxAttempts(configWithAttempts(3))).toBe(3);
  });

  it("clamps to minimum 1", () => {
    expect(getDiffVerificationMaxAttempts(configWithAttempts(0))).toBe(1);
    expect(getDiffVerificationMaxAttempts(configWithAttempts(-2))).toBe(1);
  });
});

describe("shouldRetryDiffVerification", () => {
  it("retries on diff when attempts remain", () => {
    expect(shouldRetryDiffVerification(1, "diff", 3)).toBe(true);
    expect(shouldRetryDiffVerification(2, "diff", 3)).toBe(true);
  });

  it("does not retry on last attempt", () => {
    expect(shouldRetryDiffVerification(3, "diff", 3)).toBe(false);
  });

  it("does not retry on match or new outcomes", () => {
    expect(shouldRetryDiffVerification(1, "match", 3)).toBe(false);
    expect(shouldRetryDiffVerification(1, "new", 3)).toBe(false);
    expect(shouldRetryDiffVerification(1, "missing_temp", 3)).toBe(false);
  });
});

describe("log formatters", () => {
  it("formats retry, flake suppressed and confirmed diff logs", () => {
    expect(formatDiffVerifyRetryLog(2, 3, "desktop-fhd-demo--x")).toContain("2/3");
    expect(formatFlakeSuppressedLog(2, "desktop-fhd-demo--x")).toContain("attempt 2");
    expect(formatDiffConfirmedLog(3, "desktop-fhd-demo--x")).toContain("3 attempts");
  });
});
