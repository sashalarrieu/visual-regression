/**
 * Shims Vite pour le preview Storybook navigateur (Expo / RN Web).
 *
 * `expo/src/winter/runtime.ts` et `expo/src/async-require/setup.ts` appellent
 * `require()` CJS. Vite laisse ces appels tels quels → `require is not defined`
 * dans l’iframe, `#storybook-root` vide, timeout de capture.
 *
 * `expo-updates` tire souvent ce graphe (via `env` / Apollo). On le stub aussi.
 *
 * `expo-video` lit `expo-modules-core` `SharedObject` au chargement web → crash
 * Vitest / Storybook (`Cannot read properties of undefined (reading 'SharedObject')`).
 */

const VR_EXPO_WINTER_RUNTIME_ID = "\0vr-expo-winter-runtime";
const VR_EXPO_UPDATES_ID = "\0vr-expo-updates";
const VR_EXPO_VIDEO_ID = "\0vr-expo-video";

const normalizeId = (id: string): string => id.replace(/\\/g, "/");

const isExpoWinterImporter = (importer?: string): boolean =>
  Boolean(importer && normalizeId(importer).includes("/expo/src/winter/"));

const isExpoUpdatesSource = (source: string): boolean => {
  const id = normalizeId(source);
  return id === "expo-updates" || id.startsWith("expo-updates/");
};

const isExpoVideoSource = (source: string): boolean => {
  const id = normalizeId(source);
  return id === "expo-video" || id.startsWith("expo-video/");
};

const isExpoWinterRuntimeSource = (source: string, importer?: string): boolean => {
  const id = normalizeId(source);
  if (id.includes("expo/src/winter/runtime")) return true;
  if (!isExpoWinterImporter(importer)) return false;
  return id === "./runtime" || id === "./runtime.ts" || id.endsWith("/runtime") || id.endsWith("/runtime.ts");
};

export const VR_EXPO_UPDATES_STUB_SOURCE = `
export const channel = undefined;
export const isEnabled = false;
export const reloadAsync = async () => {};
export const checkAutomatically = async () => ({ isAvailable: false });
export default { channel, isEnabled, reloadAsync, checkAutomatically };
`;

export const VR_EXPO_VIDEO_STUB_SOURCE = `
import React from "react";

export function useVideoPlayer(_source, setup) {
  const player = { muted: true, pause() {}, play() {}, replace() {} };
  setup?.(player);
  return player;
}

export function VideoView(props) {
  return React.createElement("div", {
    style: Object.assign({ backgroundColor: "#111" }, props.style || {}),
    "data-expo-video-stub": "",
  });
}

export default { useVideoPlayer, VideoView };
`;

type VitePlugin = {
  name: string;
  enforce?: "pre" | "post";
  resolveId?: (source: string, importer?: string) => string | null | undefined;
  load?: (id: string) => string | null | undefined;
};

/** Plugin Vite : no-op `expo` winter runtime + stubs `expo-updates` / `expo-video`. */
export const vrExpoBrowserShimPlugin = (): VitePlugin => ({
  name: "vr-expo-browser-shims",
  enforce: "pre",
  resolveId(source, importer) {
    if (isExpoUpdatesSource(source)) return VR_EXPO_UPDATES_ID;
    if (isExpoVideoSource(source)) return VR_EXPO_VIDEO_ID;
    if (isExpoWinterRuntimeSource(source, importer)) return VR_EXPO_WINTER_RUNTIME_ID;
    return null;
  },
  load(id) {
    if (id === VR_EXPO_WINTER_RUNTIME_ID) return "export {};\n";
    if (id === VR_EXPO_UPDATES_ID) return VR_EXPO_UPDATES_STUB_SOURCE;
    if (id === VR_EXPO_VIDEO_ID) return VR_EXPO_VIDEO_STUB_SOURCE;
    return null;
  },
});

type ViteConfigLike = {
  plugins?: unknown[];
};

/** Branche le plugin shims Expo sur la config Vite Storybook (`viteFinal`). */
export const applyVrStorybookBrowserShims = (config: ViteConfigLike): ViteConfigLike => {
  const plugin = vrExpoBrowserShimPlugin();
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  config.plugins = [plugin, ...plugins];
  return config;
};
