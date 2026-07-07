/**
 * Utilitaires Node/Bun uniquement (scripts VR).
 * Ne pas importer depuis l'app React/Expo (web) — utilise import.meta et createRequire.
 */
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { DeviceConfig, DeviceDisplayConfig, VRDeviceConfigItem, VrPublicConfig } from "@app-types/types";
import { SCREENSHOTS_DIR } from "@constants/constants";
import { resolveVrConfig } from "@utils/vr-config";

export { assertVrConfig, loadVrConfig, resolveVrConfig, VR_CONFIG_FILENAME } from "@utils/vr-config";

export const getProjectRoot = (): string => path.resolve(process.env.VR_PROJECT_ROOT || process.cwd());

/**
 * Commande et arguments pour lancer un script .ts avec Node + tsx (cross-platform: Windows, Mac, Linux).
 */
export const getNodeTsxArgs = (scriptPath: string): { command: string; args: string[] } => ({
  command: process.platform === "win32" ? "npx.cmd" : "npx",
  args: ["tsx", scriptPath],
});

/**
 * Chemin vers le CLI tsx (node + cli.mjs) pour spawn sans shell et hériter stdout correctement (Windows).
 */
export const getTsxCliPath = (packageRoot: string, projectRoot: string): string | null => {
  const candidates = [
    path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
};

/**
 * À passer dans les options de spawn sur Windows (Node 20.12+) pour éviter EINVAL avec .cmd.
 */
export const spawnShellOption = process.platform === "win32" ? { shell: true as const } : {};

/**
 * Répertoire du script appelant (Bun: import.meta.dirname, Node: fileURLToPath(import.meta.url)).
 */
export const getScriptDir = (meta: { dirname?: string; url: string }): string =>
  typeof meta.dirname !== "undefined" ? meta.dirname : path.dirname(fileURLToPath(meta.url));

export const getProjectPaths = (root: string) => {
  const publicDir = path.join(root, "public", path.sep);
  return {
    publicDir,
    publicScreenshotsDir: path.join(publicDir, SCREENSHOTS_DIR),
    deletedDir: path.join(publicDir, SCREENSHOTS_DIR, "deleted"),
    storybookConfigDir: path.join(root, ".storybook"),
  };
};

export const getDevicesNames = (devices: { name: string }[]): string[] => devices.map(d => d.name);

export const getDevicesConfig = (devices: VRDeviceConfigItem[]): Record<string, DeviceConfig> =>
  Object.fromEntries(
    devices.map(d => [
      d.name,
      {
        width: d.viewport.width,
        height: d.viewport.height,
        deviceScaleFactor: d.deviceScaleFactor ?? 1,
        mobile: d.isMobile,
      },
    ]),
  );

export const getStorybookUrl = (root?: string): string => resolveVrConfig(root ?? getProjectRoot()).storybook.url;

/** Compte les stories indexées (hors pages docs). */
export const countStorybookStories = async (root?: string): Promise<number> => {
  try {
    const res = await fetch(`${getStorybookUrl(root)}/index.json`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { entries?: Record<string, { type?: string }> };
    return Object.entries(data.entries ?? {}).filter(([id, entry]) => entry.type === "story" && !id.endsWith("--docs"))
      .length;
  } catch {
    return 0;
  }
};

/** Attend que Storybook ait indexé au moins minStories stories. */
export const waitForStorybookStories = async (minStories = 1, maxAttempts = 90, root?: string): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    const count = await countStorybookStories(root);
    if (count >= minStories) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};

export const getDevicesDisplayConfig = (root: string): DeviceDisplayConfig[] => {
  const devices = resolveVrConfig(root).devices;
  return devices.map(d => ({
    name: d.name,
    label: d.label ?? d.name,
    icon: d.icon ?? "help-outline",
    color: d.color ?? "newTheme_danger",
  }));
};

/** Config publique pour l'UI et les outils (GET /regressions/config). */
export const getVrPublicConfig = (root: string): VrPublicConfig => {
  const config = resolveVrConfig(root);
  return {
    compareMode: config.compare.mode,
    compareScope: config.compare.scope,
    compareBase: config.compare.base,
    captureConcurrency: config.capture.concurrency,
    captureMaxTestTime: config.capture.maxTestTime,
    compareThreshold: config.compare.threshold,
    launcherRunInitialCompare: config.launcher.runInitialCompare,
    storybookUrl: config.storybook.url,
    deviceCount: config.devices.length,
  };
};
