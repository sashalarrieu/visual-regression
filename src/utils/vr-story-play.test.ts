import { describe, expect, it } from "vitest";

import { formatVrPlayError, hasVisiblePortalDialogOutsideRoot, shouldReplayVrStoryPlay } from "./vr-story-play";

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

describe("hasVisiblePortalDialogOutsideRoot", () => {
  it("ignores zero-size dialogs (closed RNW Modal)", () => {
    const dialog = {
      getBoundingClientRect: () => ({ width: 0, height: 0, x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0 }),
    } as unknown as Element;
    const root = { contains: () => false };
    const doc = {
      getElementById: () => root,
      querySelectorAll: () => [dialog],
      defaultView: {
        getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      },
    };
    expect(hasVisiblePortalDialogOutsideRoot(doc)).toBe(false);
  });

  it("accepts a painted dialog outside root", () => {
    const dialog = {
      getBoundingClientRect: () => ({
        width: 320,
        height: 400,
        x: 10,
        y: 10,
        top: 10,
        left: 10,
        bottom: 410,
        right: 330,
      }),
    } as unknown as Element;
    const root = { contains: () => false };
    const doc = {
      getElementById: () => root,
      querySelectorAll: () => [dialog],
      defaultView: {
        getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      },
    };
    expect(hasVisiblePortalDialogOutsideRoot(doc)).toBe(true);
  });

  it("ignores opacity-0 dialogs (closed RNW Modal fade)", () => {
    const dialog = {
      getBoundingClientRect: () => ({
        width: 1280,
        height: 720,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 720,
        right: 1280,
      }),
      getAttribute: () => null,
    } as unknown as Element;
    const root = { contains: () => false };
    const doc = {
      getElementById: () => root,
      querySelectorAll: () => [dialog],
      defaultView: {
        innerWidth: 1280,
        innerHeight: 720,
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "0" }),
      },
    };
    expect(hasVisiblePortalDialogOutsideRoot(doc)).toBe(false);
  });

  it("ignores aria-hidden dialogs", () => {
    const dialog = {
      getBoundingClientRect: () => ({
        width: 320,
        height: 400,
        x: 10,
        y: 10,
        top: 10,
        left: 10,
        bottom: 410,
        right: 330,
      }),
      getAttribute: (name: string) => (name === "aria-hidden" ? "true" : null),
    } as unknown as Element;
    const root = { contains: () => false };
    const doc = {
      getElementById: () => root,
      querySelectorAll: () => [dialog],
      defaultView: {
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
      },
    };
    expect(hasVisiblePortalDialogOutsideRoot(doc)).toBe(false);
  });

  it("ignores empty full-viewport shells (white page behind the story)", () => {
    const dialog = {
      getBoundingClientRect: () => ({
        width: 1920,
        height: 1080,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 1080,
        right: 1920,
      }),
      getAttribute: () => null,
      innerText: "   ",
    } as unknown as Element;
    const root = { contains: () => false };
    const doc = {
      getElementById: () => root,
      querySelectorAll: () => [dialog],
      defaultView: {
        innerWidth: 1920,
        innerHeight: 1080,
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
      },
    };
    expect(hasVisiblePortalDialogOutsideRoot(doc)).toBe(false);
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
