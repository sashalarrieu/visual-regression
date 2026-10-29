import { describe, expect, it } from "vitest";

import {
  applyVrStorybookBrowserShims,
  vrExpoBrowserShimPlugin,
  VR_EXPO_UPDATES_STUB_SOURCE,
} from "./vr-vite-browser-shims";

describe("vrExpoBrowserShimPlugin", () => {
  const plugin = vrExpoBrowserShimPlugin();

  it("stubs expo-updates", () => {
    expect(plugin.resolveId?.("expo-updates")).toBe("\0vr-expo-updates");
    expect(plugin.load?.("\0vr-expo-updates")).toContain("export const channel");
    expect(VR_EXPO_UPDATES_STUB_SOURCE).toContain("reloadAsync");
  });

  it("stubs expo-video", () => {
    expect(plugin.resolveId?.("expo-video")).toBe("\0vr-expo-video");
    expect(plugin.load?.("\0vr-expo-video")).toContain("export function useVideoPlayer");
    expect(plugin.load?.("\0vr-expo-video")).toContain("export function VideoView");
  });

  it("stubs expo winter runtime from the winter index importer", () => {
    const resolved = plugin.resolveId?.("./runtime", "/work/node_modules/expo/src/winter/index.ts");
    expect(resolved).toBe("\0vr-expo-winter-runtime");
    expect(plugin.load?.("\0vr-expo-winter-runtime")).toBe("export {};\n");
  });

  it("does not stub unrelated relative runtime imports", () => {
    expect(plugin.resolveId?.("./runtime", "/work/src/atoms/Foo.ts")).toBeNull();
  });
});

describe("applyVrStorybookBrowserShims", () => {
  it("prepends the shim plugin", () => {
    const config = { plugins: [{ name: "existing" }] };
    applyVrStorybookBrowserShims(config);
    expect(config.plugins[0]).toMatchObject({ name: "vr-expo-browser-shims" });
    expect(config.plugins[1]).toMatchObject({ name: "existing" });
  });
});
