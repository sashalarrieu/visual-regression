import { describe, expect, it } from "vitest";

import { PLAY_FN_TAG, SKIP_PLAY_VR_TAG } from "../constants/constants";

import {
  appendVrCaptureParam,
  clampCaptureClipToViewport,
  expectsVrStoryPlay,
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
  it("adds vr-capture=1 to iframe URLs", () => {
    const url = "http://localhost:6006/iframe.html?id=demo-button--primary&viewMode=story";
    expect(appendVrCaptureParam(url)).toContain("vr-capture=1");
  });

  it("is idempotent when vr-capture is already set", () => {
    const url = "http://localhost:6006/iframe.html?id=demo--x&vr-capture=1";
    expect(appendVrCaptureParam(url)).toBe("http://localhost:6006/iframe.html?id=demo--x&vr-capture=1");
  });

  it("falls back for malformed URLs", () => {
    expect(appendVrCaptureParam("not-a-url")).toBe("not-a-url?vr-capture=1");
    expect(appendVrCaptureParam("not-a-url?foo=1")).toBe("not-a-url?foo=1&vr-capture=1");
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
