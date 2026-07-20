/**
 * Utilitaires Node/Bun uniquement (scripts VR).
 * Ne pas importer depuis l'app React/Expo (web) — utilise import.meta et createRequire.
 */
import { existsSync, readFileSync, realpathSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import { FORCE_VR_TAG, IGNORE_VR_TAG, SCREENSHOTS_DIR } from "../constants/constants";
import type { DeviceConfig, DeviceDisplayConfig, VRDeviceConfigItem, VrPublicConfig } from "../types/types";

import { resolveVrConfig } from "./vr-config";

export { assertVrConfig, loadVrConfig, resolveVrConfig, VR_CONFIG_FILENAME } from "./vr-config";

export const getProjectRoot = (): string => path.resolve(process.env.VR_PROJECT_ROOT || process.cwd());

/**
 * Commande et arguments pour lancer un script .ts avec Node + tsx (cross-platform: Windows, Mac, Linux).
 */
export const getNodeTsxArgs = (scriptPath: string): { command: string; args: string[] } => ({
  command: process.platform === "win32" ? "npx.cmd" : "npx",
  args: ["tsx", scriptPath],
});

export const TSX_TSCONFIG_ENV = "TSX_TSCONFIG_PATH";

const resolveTsxFromPackageJson = (pkgJsonPath: string): string | null => {
  try {
    if (!existsSync(pkgJsonPath)) return null;
    const realPkg = realpathSync(pkgJsonPath);
    const req = createRequire(realPkg);
    const tsxPkg = req.resolve("tsx/package.json");
    return path.join(path.dirname(tsxPkg), "dist", "cli.mjs");
  } catch {
    return null;
  }
};

/**
 * Chemin vers le CLI tsx (node + cli.mjs) pour spawn sans shell et hériter stdout correctement (Windows).
 * Résout aussi le layout pnpm (realpath + createRequire) et les dépendances file:.
 */
export const getTsxCliPath = (packageRoot: string, projectRoot: string): string | null => {
  const candidates = [
    resolveTsxFromPackageJson(path.join(projectRoot, "node_modules", "@setshao", "visual-regression", "package.json")),
    resolveTsxFromPackageJson(path.join(packageRoot, "package.json")),
    path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  ];

  let dir = packageRoot;
  for (let depth = 0; depth < 12 && dir; depth += 1) {
    candidates.push(path.join(dir, "node_modules", "tsx", "dist", "cli.mjs"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
};

/** tsconfig CLI du package (scripts VR lancés via tsx). */
export const getPackageCliTsconfigPath = (packageRoot: string): string => path.join(packageRoot, "tsconfig.cli.json");

/**
 * Racine d'installation du package (@setshao/visual-regression) avec node_modules résolvables.
 * - file: → préfère la source liée si elle a node_modules (dev local)
 * - npm/pnpm publié → répertoire réel sous node_modules du consommateur
 */
export const resolvePackageInstallRoot = (projectRoot: string, packageRoot: string): string => {
  const consumerPkgPath = path.join(projectRoot, "package.json");
  if (existsSync(consumerPkgPath)) {
    try {
      const consumerPkg = JSON.parse(readFileSync(consumerPkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const depSpec =
        consumerPkg.dependencies?.["@setshao/visual-regression"] ??
        consumerPkg.devDependencies?.["@setshao/visual-regression"];

      if (typeof depSpec === "string" && depSpec.startsWith("file:")) {
        const linkedSource = path.resolve(projectRoot, depSpec.slice("file:".length));
        if (existsSync(path.join(linkedSource, "node_modules", "expo"))) {
          return linkedSource;
        }
      }
    } catch {
      // fall through
    }
  }

  const linkedPkgJson = path.join(projectRoot, "node_modules", "@setshao", "visual-regression", "package.json");
  if (existsSync(linkedPkgJson)) {
    try {
      return path.dirname(realpathSync(linkedPkgJson));
    } catch {
      // fall through
    }
  }
  return packageRoot;
};

/**
 * À passer dans les options de spawn sur Windows (Node 20.12+) pour éviter EINVAL avec .cmd.
 */
export const spawnShellOption = process.platform === "win32" ? { shell: true as const } : {};

export type PackageRunner = "pnpm" | "yarn" | "npm";

/** Détecte le gestionnaire de paquets du projet hôte (lockfile ou VR_PACKAGE_MANAGER). */
export const resolvePackageRunner = (projectRoot: string): PackageRunner => {
  const env = process.env.VR_PACKAGE_MANAGER?.toLowerCase();
  if (env === "pnpm" || env === "yarn" || env === "npm") return env;

  if (existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(projectRoot, "package-lock.json"))) return "npm";
  return "yarn";
};

/** Commande pour exécuter un script npm du package.json hôte (storybook:build:stats, etc.). */
export const getPackageScriptCommand = (
  projectRoot: string,
  scriptName: string,
): { command: string; args: string[] } => {
  const runner = resolvePackageRunner(projectRoot);
  if (runner === "yarn") {
    return { command: "yarn", args: [scriptName] };
  }
  const command = runner === "npm" && process.platform === "win32" ? "npm.cmd" : runner;
  return { command, args: ["run", scriptName] };
};

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

/** Vérifie que Storybook répond côté hôte (index.json + page UI). */
export const probeStorybookHost = async (root?: string): Promise<{ ok: boolean; storyCount: number }> => {
  const baseUrl = getStorybookUrl(root);
  try {
    const indexRes = await fetch(`${baseUrl}/index.json`);
    if (!indexRes.ok) return { ok: false, storyCount: 0 };
    const data = (await indexRes.json()) as { entries?: Record<string, { type?: string }> };
    const storyCount = Object.entries(data.entries ?? {}).filter(
      ([id, entry]) => entry.type === "story" && !id.endsWith("--docs"),
    ).length;
    if (storyCount < 1) return { ok: false, storyCount: 0 };

    const uiRes = await fetch(`${baseUrl}/`, { redirect: "follow" });
    if (!uiRes.ok) return { ok: false, storyCount };

    return { ok: true, storyCount };
  } catch {
    return { ok: false, storyCount: 0 };
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

/**
 * Attend que Storybook soit joignable depuis l'hôte (forward Docker).
 * Exige plusieurs sondes consécutives pour éviter un faux « prêt » pendant le boot Vite.
 */
export const waitForStorybookHostReady = async (
  minStories = 1,
  maxAttempts = 120,
  root?: string,
  consecutiveRequired = 2,
): Promise<{ ready: boolean; storyCount: number }> => {
  let consecutive = 0;
  let lastCount = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const probe = await probeStorybookHost(root);
    lastCount = probe.storyCount;
    if (probe.ok && probe.storyCount >= minStories) {
      consecutive += 1;
      if (consecutive >= consecutiveRequired) {
        return { ready: true, storyCount: probe.storyCount };
      }
    } else {
      consecutive = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { ready: false, storyCount: lastCount };
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

/** Compte les stories Storybook éligibles VR (même filtre que compare / CompareModal). */
export const countEligibleStorybookStories = async (storybookUrl: string): Promise<number> => {
  try {
    const res = await fetch(`${storybookUrl.replace(/\/$/, "")}/index.json`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { entries?: Record<string, { type?: string; tags?: string[] }> };
    return Object.entries(data.entries ?? {}).filter(([id, entry]) => {
      if (entry.type !== "story" || id.endsWith("--docs")) return false;
      const tags = entry.tags ?? [];
      return tags.includes(FORCE_VR_TAG) || !tags.includes(IGNORE_VR_TAG);
    }).length;
  } catch {
    return 0;
  }
};

/** Config publique pour l'UI et les outils (GET /regressions/config). */
export const getVrPublicConfig = (root: string): VrPublicConfig => {
  const config = resolveVrConfig(root);
  return {
    compareMode: config.compare.mode,
    compareScope: config.compare.scope,
    compareBase: config.compare.base,
    captureConcurrency: config.capture.concurrency,
    captureConcurrencyDev: config.capture.concurrencyDev,
    captureMaxTestTime: config.capture.maxTestTime,
    captureRemoteChunkSize: config.capture.remoteChunkSize,
    captureBackend: config.capture.backend,
    compareThreshold: config.compare.threshold,
    launcherRunInitialCompare: config.launcher.runInitialCompare,
    storybookUrl: config.storybook.url,
    deviceCount: config.devices.length,
  };
};
