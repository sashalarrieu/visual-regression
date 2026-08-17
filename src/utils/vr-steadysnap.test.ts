import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
  LIVE_ANIMATION_VR_TAG,
  PLAY_FN_TAG,
  SKIP_PLAY_VR_TAG,
  VR_CAPTURE_ANIMATION_FREEZE_CSS,
} from "../constants/constants";

import { createTestVrConfig } from "./test-helpers";
import {
  appendVrCaptureParam,
  applyCaptureMotionPreference,
  clampCaptureClipToViewport,
  expectsVrStoryPlay,
  shouldFreezeMotion,
  unionCaptureClips,
} from "./vr-steadysnap";

describe("expectsVrStoryPlay", () => {
  it("expects play when play-fn is present and skip-play-vr is absent", () => {
    expect(expectsVrStoryPlay([PLAY_FN_TAG])).toBe(true);
    expect(expectsVrStoryPlay([PLAY_FN_TAG, "autodocs"])).toBe(true);
  });

  it("skips play when skip-play-vr is present", () => {
    expect(expectsVrStoryPlay([PLAY_FN_TAG, SKIP_PLAY_VR_TAG])).toBe(false);
  });

  it("does not expect play without play-fn", () => {
    expect(expectsVrStoryPlay([])).toBe(false);
    expect(expectsVrStoryPlay([SKIP_PLAY_VR_TAG])).toBe(false);
  });
});

describe("appendVrCaptureParam", () => {
  it("adds vr-capture=1 and embed=true to iframe URLs", () => {
    const url = "http://localhost:6006/iframe.html?id=demo-button--primary&viewMode=story";
    const next = appendVrCaptureParam(url);
    expect(next).toContain("vr-capture=1");
    expect(next).toContain("embed=true");
  });

  it("is idempotent when capture params are already set", () => {
    const url = "http://localhost:6006/iframe.html?id=demo--x&viewMode=story";
    const once = appendVrCaptureParam(url);
    expect(appendVrCaptureParam(once)).toBe(once);
  });

  it("falls back for malformed URLs", () => {
    expect(appendVrCaptureParam("not-a-url")).toBe("not-a-url?vr-capture=1&embed=true");
    expect(appendVrCaptureParam("not-a-url?foo=1")).toBe("not-a-url?foo=1&vr-capture=1&embed=true");
  });
});

describe("shouldFreezeMotion", () => {
  const config = createTestVrConfig();

  it("freezes by default when freezeAnimations is true", () => {
    expect(shouldFreezeMotion(config, [])).toBe(true);
  });

  it("opts out for live-animation-vr", () => {
    expect(shouldFreezeMotion(config, [LIVE_ANIMATION_VR_TAG])).toBe(false);
  });

  it("does not freeze when freezeAnimations is false", () => {
    const off = createTestVrConfig({
      stabilize: { ...config.stabilize, freezeAnimations: false },
    });
    expect(shouldFreezeMotion(off, [])).toBe(false);
  });
});

describe("applyCaptureMotionPreference", () => {
  it("emulates reduced motion before navigation", async () => {
    const emulateMedia = vi.fn().mockResolvedValue(undefined);
    const page = { emulateMedia } as unknown as Page;

    await applyCaptureMotionPreference(page, true);

    expect(emulateMedia).toHaveBeenCalledWith({ reducedMotion: "reduce" });
  });

  it("emulates no-preference when freeze is off", async () => {
    const emulateMedia = vi.fn().mockResolvedValue(undefined);
    const page = { emulateMedia } as unknown as Page;

    await applyCaptureMotionPreference(page, false);

    expect(emulateMedia).toHaveBeenCalledWith({ reducedMotion: "no-preference" });
  });
});

describe("VR_CAPTURE_ANIMATION_FREEZE_CSS", () => {
  it("stops infinite CSS loops instead of freezing the first keyframe", () => {
    expect(VR_CAPTURE_ANIMATION_FREEZE_CSS).toContain("animation-iteration-count: 1");
    expect(VR_CAPTURE_ANIMATION_FREEZE_CSS).toContain("0.001ms");
  });
});

describe("capture clip helpers (portaled modals)", () => {
  it("unions root and modal boxes so the dialog is not cropped out", () => {
    const root = { x: 100, y: 40, width: 200, height: 120 };
    // Modal centered on a larger viewport — mostly outside the tight root box
    const modal = { x: 40, y: 200, width: 320, height: 280 };
    const union = unionCaptureClips(root, modal);
    expect(union).toEqual({ x: 40, y: 40, width: 320, height: 440 });
  });

  it("clamps expanded clip to the viewport", () => {
    const clipped = clampCaptureClipToViewport(
      { x: -10, y: -5, width: 2000, height: 1500 },
      { width: 1280, height: 720 },
    );
    expect(clipped).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});
