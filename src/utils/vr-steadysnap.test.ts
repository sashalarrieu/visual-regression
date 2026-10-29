import type { Page } from "playwright";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";

import {
  LIVE_ANIMATION_VR_TAG,
  PLAY_FN_TAG,
  SKIP_PLAY_VR_TAG,
  VR_CAPTURE_ANIMATION_FREEZE_CSS,
  VR_CAPTURE_CLASSIC_SCROLLBAR_CSS,
  VR_CAPTURE_FOCUS_RESET_CSS,
} from "../constants/constants";

import { createTestVrConfig } from "./test-helpers";
import {
  appendVrCaptureParam,
  applyCaptureMotionPreference,
  applyCaptureFocusReset,
  APPLY_CLASSIC_SCROLLBARS_JS,
  clampCaptureClipToViewport,
  expectsVrStoryPlay,
  shouldFreezeMotion,
  STORY_CAPTURE_ASSERT_SURFACE_JS,
  STORY_CAPTURE_SURFACE_READY_JS,
  unionCaptureClips,
  trimTrailingWhitePng,
} from "./vr-steadysnap";

describe("STORY_CAPTURE_SURFACE_READY_JS", () => {
  it("treats a portaled dialog as ready when #storybook-root is hidden", () => {
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain('[role="dialog"]');
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("aria-modal");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("rootPainted");
  });

  it("fails fast when Storybook shows the preview error overlay", () => {
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("sb-show-errordisplay");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("Storybook preview error:");
  });

  it("waits while the Storybook preparing overlay is visible", () => {
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("sb-show-preparing-story");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("isStorybookPreparing");
  });
});

describe("STORY_CAPTURE_ASSERT_SURFACE_JS", () => {
  it("turns an unloaded or preparing preview into a capture error", () => {
    expect(STORY_CAPTURE_ASSERT_SURFACE_JS).toContain("story not loaded");
    expect(STORY_CAPTURE_ASSERT_SURFACE_JS).toContain("sb-show-nopreview");
    expect(STORY_CAPTURE_ASSERT_SURFACE_JS).toContain("#storybook-root is empty");
    expect(STORY_CAPTURE_ASSERT_SURFACE_JS).toContain("no visible content");
  });

  it("does not treat a zero-height RNW modal host as a closed overlay to hide", () => {
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("containsOpenPortalDialog");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("isClosedDialogLeaf");
  });
});

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

describe("VR_CAPTURE_FOCUS_RESET_CSS", () => {
  it("kills UA focus rings that survive host outline:unset", () => {
    expect(VR_CAPTURE_FOCUS_RESET_CSS).toContain("outline: none !important");
    expect(VR_CAPTURE_FOCUS_RESET_CSS).toContain("caret-color: transparent");
    expect(VR_CAPTURE_FOCUS_RESET_CSS).toContain('[role="dialog"]:focus');
  });
});

describe("applyCaptureFocusReset", () => {
  it("injects the focus-reset CSS into the page", async () => {
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const page = { evaluate } as unknown as Page;

    await applyCaptureFocusReset(page);

    expect(evaluate).toHaveBeenCalledTimes(1);
    const [fn, arg] = evaluate.mock.calls[0] as [Function, { css: string; styleId: string }];
    expect(arg.css).toContain("outline: none !important");
    expect(arg.styleId).toBe("vr-capture-focus-reset");
    expect(String(fn)).not.toMatch(/\.blur\s*\(/);
  });
});

describe("VR_CAPTURE_ANIMATION_FREEZE_CSS", () => {
  it("stops infinite CSS loops instead of freezing the first keyframe", () => {
    expect(VR_CAPTURE_ANIMATION_FREEZE_CSS).toContain("animation-iteration-count: 1");
    expect(VR_CAPTURE_ANIMATION_FREEZE_CSS).toContain("0.001ms");
  });
});

describe("classic scrollbars for capture", () => {
  it("forces visible webkit scrollbars", () => {
    expect(VR_CAPTURE_CLASSIC_SCROLLBAR_CSS).toContain("::-webkit-scrollbar");
    expect(VR_CAPTURE_CLASSIC_SCROLLBAR_CSS).toContain("scrollbar-width: thin");
  });

  it("upgrades overflow auto/scroll/hidden that actually overflow", () => {
    expect(APPLY_CLASSIC_SCROLLBARS_JS).toContain('overflow-y", "scroll"');
    expect(APPLY_CLASSIC_SCROLLBARS_JS).toContain("scrollHeight > el.clientHeight");
    expect(APPLY_CLASSIC_SCROLLBARS_JS).toContain('value === "hidden"');
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

  it("ignores closed empty full-viewport shells instead of expanding the clip", () => {
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("isClosedOrEmptyPortal");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("coversViewportBox");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("sb-preparing-story");
    expect(STORY_CAPTURE_ASSERT_SURFACE_JS).toContain("isOpenPortalOverlay");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("containsOpenPortalDialog");
    expect(STORY_CAPTURE_SURFACE_READY_JS).toContain("isOverlayLayer");
  });

  it("trims full-width white rows at the bottom of a PNG", () => {
    const img = new PNG({ width: 4, height: 4 });
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        const tone = y < 2 ? 80 : 255;
        img.data[i] = tone;
        img.data[i + 1] = tone;
        img.data[i + 2] = tone;
        img.data[i + 3] = 255;
      }
    }
    const trimmed = PNG.sync.read(trimTrailingWhitePng(PNG.sync.write(img)));
    expect(trimmed.width).toBe(4);
    expect(trimmed.height).toBe(2);
  });
});
