import { afterEach, describe, expect, it } from "vitest";

import { isVrCaptureStorybook, vrStorybookAddons } from "./vr-storybook-addons";

describe("vrStorybookAddons", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VR_DOCKER;
    delete process.env.VR_CAPTURE;
  });

  const addons = ["@storybook/addon-docs", "@storybook/addon-vitest", "@storybook/addon-a11y"];

  it("conserve les addons hors capture VR", () => {
    delete process.env.VR_DOCKER;
    delete process.env.VR_CAPTURE;
    expect(isVrCaptureStorybook()).toBe(false);
    expect(vrStorybookAddons(addons)).toEqual(addons);
  });

  it("retire addon-vitest dans le sidecar Docker", () => {
    process.env.VR_DOCKER = "1";
    expect(vrStorybookAddons(addons)).toEqual(["@storybook/addon-docs", "@storybook/addon-a11y"]);
  });
});
