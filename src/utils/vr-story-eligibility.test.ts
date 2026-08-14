import { describe, expect, it } from "vitest";

import {
  collectIgnoredVrStoryIds,
  formatIgnoreVrFallbackLog,
  isIgnoredVrStory,
  shouldIncludeStoryForVisualRegression,
} from "./vr-story-eligibility";

describe("isIgnoredVrStory", () => {
  it("retourne true pour ignore-vr sans force-vr", () => {
    expect(isIgnoredVrStory(["ignore-vr"])).toBe(true);
  });

  it("retourne false pour force-vr ou sans ignore-vr", () => {
    expect(isIgnoredVrStory(["ignore-vr", "force-vr"])).toBe(false);
    expect(isIgnoredVrStory([])).toBe(false);
    expect(isIgnoredVrStory(undefined)).toBe(false);
  });
});

describe("shouldIncludeStoryForVisualRegression", () => {
  it("exclut docs et ignore-vr", () => {
    expect(shouldIncludeStoryForVisualRegression({ id: "a--docs", type: "story", tags: [] })).toBe(false);
    expect(shouldIncludeStoryForVisualRegression({ id: "a--default", type: "story", tags: ["ignore-vr"] })).toBe(false);
  });

  it("inclut les stories capturables", () => {
    expect(shouldIncludeStoryForVisualRegression({ id: "a--default", type: "story", tags: [] })).toBe(true);
    expect(
      shouldIncludeStoryForVisualRegression({ id: "a--forced", type: "story", tags: ["ignore-vr", "force-vr"] }),
    ).toBe(true);
  });
});

describe("collectIgnoredVrStoryIds", () => {
  it("collecte les ids ignore-vr", () => {
    const ids = collectIgnoredVrStoryIds({
      a: { id: "a--x", tags: ["ignore-vr"] },
      b: { id: "b--y", tags: ["ignore-vr", "force-vr"] },
      c: { id: "c--z", tags: [] },
    });
    expect(Array.from(ids)).toEqual(["a--x"]);
  });
});

describe("formatIgnoreVrFallbackLog", () => {
  it("formate le message fallback", () => {
    expect(formatIgnoreVrFallbackLog("demo--default", "desktop-fhd")).toContain("ignore-vr fallback");
    expect(formatIgnoreVrFallbackLog("demo--default", "desktop-fhd")).toContain("desktop-fhd/demo--default");
  });
});
