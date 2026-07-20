import { afterEach, describe, expect, it } from "vitest";

import { createTestVrConfig } from "../utils/test-helpers";

import { resolveConcurrencyDetails } from "./vr-capture-engine";

describe("resolveConcurrencyDetails", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses concurrencyDev when Storybook mode is dev", () => {
    process.env.VR_STORYBOOK_MODE = "dev";
    const config = createTestVrConfig({
      capture: {
        ...createTestVrConfig().capture,
        concurrency: 15,
        concurrencyDev: 2,
      },
    });
    const resolved = resolveConcurrencyDetails(100, config);
    expect(resolved).toMatchObject({
      workers: 2,
      profile: "dev",
      configured: 2,
      concurrency: 15,
      concurrencyDev: 2,
    });
  });

  it("uses concurrency when Storybook mode is static (CI / static local)", () => {
    process.env.VR_STORYBOOK_MODE = "static";
    const config = createTestVrConfig({
      capture: {
        ...createTestVrConfig().capture,
        concurrency: 15,
        concurrencyDev: 2,
      },
    });
    const resolved = resolveConcurrencyDetails(100, config);
    expect(resolved).toMatchObject({
      workers: 15,
      profile: "static",
      configured: 15,
      concurrency: 15,
      concurrencyDev: 2,
    });
  });

  it("caps workers by taskCount", () => {
    process.env.VR_STORYBOOK_MODE = "static";
    const config = createTestVrConfig({
      capture: {
        ...createTestVrConfig().capture,
        concurrency: 15,
      },
    });
    expect(resolveConcurrencyDetails(3, config).workers).toBe(3);
  });
});
