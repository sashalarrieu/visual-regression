import { describe, expect, it } from "vitest";

import { formatVrPlayError, shouldReplayVrStoryPlay } from "./vr-story-play";

describe("shouldReplayVrStoryPlay", () => {
  it("does not replay when a portal is already open", () => {
    expect(shouldReplayVrStoryPlay({ hasPortal: true, playStarted: false })).toBe(false);
    expect(shouldReplayVrStoryPlay({ hasPortal: true, playStarted: true })).toBe(false);
  });

  it("does not replay when Storybook already ran play()", () => {
    expect(shouldReplayVrStoryPlay({ hasPortal: false, playStarted: true })).toBe(false);
  });

  it("replays when Storybook never started play (static no-op / timeout)", () => {
    expect(shouldReplayVrStoryPlay({ hasPortal: false, playStarted: false })).toBe(true);
  });
});

describe("formatVrPlayError", () => {
  it("reads Error.message", () => {
    expect(formatVrPlayError(new Error("Unable to find Segment2"))).toBe("Unable to find Segment2");
  });

  it("reads strings", () => {
    expect(formatVrPlayError("boom")).toBe("boom");
  });

  it("returns empty for nullish", () => {
    expect(formatVrPlayError(null)).toBe("");
    expect(formatVrPlayError(undefined)).toBe("");
  });
});
