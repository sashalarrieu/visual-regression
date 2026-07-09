import { describe, expect, it } from "vitest";

import { BURST_VR_TAG } from "../constants/constants";

import { createTestVrConfig } from "./test-helpers";
import { normalizeStoryVrParameters, resolveEffectiveVrConfig, shouldUseBurstCapture } from "./vr-story-config";

describe("normalizeStoryVrParameters", () => {
  it("returns null for invalid input", () => {
    expect(normalizeStoryVrParameters(null)).toBeNull();
    expect(normalizeStoryVrParameters("foo")).toBeNull();
    expect(normalizeStoryVrParameters([])).toBeNull();
    expect(normalizeStoryVrParameters({ foo: "bar" })).toBeNull();
  });

  it("keeps known keys and ignores unknown ones", () => {
    expect(
      normalizeStoryVrParameters({
        stabilize: { burstIntervalMs: 500, unknown: true },
        diffVerificationMaxAttempts: 5,
        extra: "ignored",
      }),
    ).toEqual({
      stabilize: { burstIntervalMs: 500 },
      diffVerificationMaxAttempts: 5,
    });
  });

  it("ignores non-positive numeric values", () => {
    expect(
      normalizeStoryVrParameters({
        stabilize: { burstIntervalMs: 0, waitNetworkQuietMs: -1 },
        diffVerificationMaxAttempts: 0,
      }),
    ).toBeNull();
  });
});

describe("resolveEffectiveVrConfig", () => {
  it("returns the base config when no story overrides are provided", () => {
    const config = createTestVrConfig();
    expect(resolveEffectiveVrConfig(config, null)).toBe(config);
  });

  it("merges partial story overrides without clobbering defaults", () => {
    const config = createTestVrConfig();
    const merged = resolveEffectiveVrConfig(config, {
      stabilize: { burstIntervalMs: 1000 },
      diffVerificationMaxAttempts: 5,
    });

    expect(merged.stabilize.burstIntervalMs).toBe(1000);
    expect(merged.stabilize.freezeAnimations).toBe(config.stabilize.freezeAnimations);
    expect(merged.compare.diffVerificationMaxAttempts).toBe(5);
  });
});

describe("shouldUseBurstCapture", () => {
  it("uses global config when enabled", () => {
    const config = createTestVrConfig({
      stabilize: { ...createTestVrConfig().stabilize, burstCapture: true },
    });
    expect(shouldUseBurstCapture(config, [])).toBe(true);
  });

  it("activates burst from tag or story parameters", () => {
    const config = createTestVrConfig();
    expect(shouldUseBurstCapture(config, [BURST_VR_TAG])).toBe(true);
    expect(shouldUseBurstCapture(config, [], { stabilize: { burstIntervalMs: 250 } })).toBe(true);
    expect(shouldUseBurstCapture(config, [], { stabilize: { burstFrames: 5 } })).toBe(true);
    expect(shouldUseBurstCapture(config, [], { stabilize: { burstCapture: true } })).toBe(true);
  });

  it("stays disabled without tag, override or global flag", () => {
    const config = createTestVrConfig();
    expect(shouldUseBurstCapture(config, [])).toBe(false);
    expect(shouldUseBurstCapture(config, [], null)).toBe(false);
  });
});
