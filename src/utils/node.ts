/**
 * Utilitaires Node/Bun uniquement (scripts VR).
 * Ne pas importer depuis l'app React/Expo (web) — utilise import.meta et createRequire.
 */
import { existsSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import type { DeviceConfig, DeviceDisplayConfig, VRDeviceConfigItem } from "@app-types/types";
import { SCREENSHOTS_DIR } from "@constants/constants";

const _require = createRequire(import.meta.url);
const VR_DEVICES_CONFIG_FILENAME = "vr-devices.config.cjs";

export const getProjectRoot = (): string => path.resolve(process.env.VR_PROJECT_ROOT || process.cwd());

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

export const assertVrDevicesConfig = (root: string): void => {
  const configPath = path.join(root, VR_DEVICES_CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    console.error(
      `\n❌ Fichier de configuration requis manquant : ${VR_DEVICES_CONFIG_FILENAME}\n` +
        `   Créez ce fichier à la racine de votre projet (${root}).\n` +
        `   Voir la documentation : https://github.com/setshao/visual-regression#readme\n`,
    );
    process.exit(1);
  }
  const config = _require(configPath);
  if (!Array.isArray(config) || config.length === 0) {
    console.error(`\n❌ Le fichier ${VR_DEVICES_CONFIG_FILENAME} doit exporter un tableau non vide de devices.\n`);
    process.exit(1);
  }
};

export const loadVrDevicesConfig = (root: string): VRDeviceConfigItem[] => {
  assertVrDevicesConfig(root);
  return _require(path.join(root, VR_DEVICES_CONFIG_FILENAME)) || [];
};

export const getDevicesNames = (config: VRDeviceConfigItem[]): string[] => config.map(d => d.name);

export const getDevicesConfig = (config: VRDeviceConfigItem[]): Record<string, DeviceConfig> =>
  Object.fromEntries(
    config.map(d => [
      d.name,
      {
        width: d.viewport.width,
        height: d.viewport.height,
        deviceScaleFactor: d.deviceScaleFactor ?? 1,
        mobile: d.isMobile,
      },
    ]),
  );

export const getDevicesDisplayConfig = (root: string): DeviceDisplayConfig[] => {
  const config = loadVrDevicesConfig(root);
  return config.map(d => ({
    name: d.name,
    label: d.label ?? d.name,
    icon: d.icon ?? "hint",
    color: d.color ?? "newTheme_danger",
  }));
};
