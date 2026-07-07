/**
 * Chargement et résolution de vr.config.cjs (projet hôte).
 * Ne pas importer depuis l'app React/Expo (web).
 */
import { existsSync } from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";

import type { VrConfig, VrConfigFile, VrCompareMode, VrChangedFilesScope } from "@app-types/types";

const _require = createRequire(import.meta.url);

export const VR_CONFIG_FILENAME = "vr.config.cjs";
const LEGACY_CONFIG_FILENAME = "vr-devices.config.cjs";

const DEFAULT_STORYBOOK_URL = "http://localhost:6006";

const DEFAULT_GLOBAL_TRIGGERS = [".storybook/**", "package.json", "yarn.lock", "vr.config.cjs"];

const defaultConcurrency = (): number => Math.max(2, Math.min(os.cpus().length, 8));

const parsePositiveEnv = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const envBool = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (value === "1" || lower === "true" || lower === "yes") return true;
  if (value === "0" || lower === "false" || lower === "no") return false;
  return undefined;
};

const parseEnvCompareMode = (): VrCompareMode | undefined => {
  const value = process.env.VR_COMPARE_MODE;
  if (value === "incremental" || value === "full") return value;
  return undefined;
};

const parseEnvCompareScope = (): VrChangedFilesScope | undefined => {
  const value = process.env.VR_COMPARE_SCOPE;
  if (value === "all" || value === "branch" || value === "working-tree") return value;
  return undefined;
};

export const getDefaultVrConfig = (): VrConfig => ({
  devices: [],
  capture: {
    concurrency: defaultConcurrency(),
    maxTestTime: 10_000,
  },
  compare: {
    mode: "incremental",
    base: "origin/main",
    scope: "all",
    includeWorkingTree: true,
    threshold: 0,
    globalTriggers: [...DEFAULT_GLOBAL_TRIGGERS],
    statsFile: "storybook-static/preview-stats.json",
    manifestPath: ".vr-cache/manifest.json",
  },
  launcher: {
    runInitialCompare: true,
    storybookStatic: false,
  },
  storybook: {
    url: DEFAULT_STORYBOOK_URL,
  },
  stabilize: {
    freezeAnimations: true,
    waitNetworkQuietMs: 0,
    waitFonts: true,
    burstCapture: false,
    burstFrames: 3,
    burstIntervalMs: 100,
    flakeRetryThreshold: 50,
    maxStabilizeTime: 5_000,
  },
});

const mergeVrConfig = (fileConfig: VrConfigFile, defaults: VrConfig): VrConfig => ({
  devices: fileConfig.devices ?? defaults.devices,
  capture: { ...defaults.capture, ...fileConfig.capture },
  compare: { ...defaults.compare, ...fileConfig.compare },
  launcher: { ...defaults.launcher, ...fileConfig.launcher },
  storybook: { ...defaults.storybook, ...fileConfig.storybook },
  stabilize: { ...defaults.stabilize, ...fileConfig.stabilize },
});

export const assertVrConfig = (root: string): void => {
  const configPath = path.join(root, VR_CONFIG_FILENAME);
  const legacyPath = path.join(root, LEGACY_CONFIG_FILENAME);

  if (existsSync(configPath)) return;

  if (existsSync(legacyPath)) {
    console.error(
      `\n❌ Fichier de configuration requis manquant : ${VR_CONFIG_FILENAME}\n` +
        `   Ancien fichier détecté : ${LEGACY_CONFIG_FILENAME}\n` +
        `   Renommez-le en ${VR_CONFIG_FILENAME} et enveloppez les devices dans un objet :\n` +
        `   module.exports = { devices: [ /* vos devices */ ] };\n`,
    );
    process.exit(1);
  }

  console.error(
    `\n❌ Fichier de configuration requis manquant : ${VR_CONFIG_FILENAME}\n` +
      `   Créez ce fichier à la racine de votre projet (${root}).\n` +
      `   Voir la documentation : https://github.com/setshao/visual-regression#readme\n`,
  );
  process.exit(1);
};

/** Charge vr.config.cjs sans appliquer les overrides d'environnement. */
export const loadVrConfig = (root: string): VrConfig => {
  assertVrConfig(root);
  const raw = _require(path.join(root, VR_CONFIG_FILENAME)) as VrConfigFile | unknown;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.error(`\n❌ Le fichier ${VR_CONFIG_FILENAME} doit exporter un objet avec une clé "devices".\n`);
    process.exit(1);
  }

  const fileConfig = raw as VrConfigFile;
  if (!Array.isArray(fileConfig.devices) || fileConfig.devices.length === 0) {
    console.error(`\n❌ Le fichier ${VR_CONFIG_FILENAME} doit définir un tableau "devices" non vide.\n`);
    process.exit(1);
  }

  return mergeVrConfig(fileConfig, getDefaultVrConfig());
};

/** Résolution finale : env var (VR_*) > vr.config.cjs > défauts package. */
export const resolveVrConfig = (root?: string): VrConfig => {
  const projectRoot = root ?? path.resolve(process.env.VR_PROJECT_ROOT || process.cwd());
  const config = loadVrConfig(projectRoot);

  const envConcurrency = parsePositiveEnv(process.env.VR_CONCURRENCY);
  const envMaxTestTime = parsePositiveEnv(process.env.VR_MAX_TEST_TIME);
  const envThreshold = process.env.VR_THRESHOLD !== undefined ? Number(process.env.VR_THRESHOLD) : undefined;
  const compareMode = parseEnvCompareMode();
  const compareScope = parseEnvCompareScope();
  const envCompareBase = process.env.VR_COMPARE_BASE;
  const envStorybookUrl = process.env.VR_STORYBOOK_URL;
  const envRunInitialCompare = envBool(process.env.VR_RUN_INITIAL_COMPARE);
  const envStorybookStatic = envBool(process.env.VR_STORYBOOK_STATIC);

  return {
    ...config,
    capture: {
      ...config.capture,
      ...(envConcurrency !== undefined ? { concurrency: envConcurrency } : {}),
      ...(envMaxTestTime !== undefined ? { maxTestTime: envMaxTestTime } : {}),
    },
    compare: {
      ...config.compare,
      ...(compareMode !== undefined ? { mode: compareMode } : {}),
      ...(compareScope !== undefined ? { scope: compareScope } : {}),
      ...(envCompareBase ? { base: envCompareBase } : {}),
      ...(envThreshold !== undefined && Number.isFinite(envThreshold) ? { threshold: envThreshold } : {}),
    },
    launcher: {
      ...config.launcher,
      ...(envRunInitialCompare !== undefined ? { runInitialCompare: envRunInitialCompare } : {}),
      ...(envStorybookStatic !== undefined ? { storybookStatic: envStorybookStatic } : {}),
    },
    storybook: {
      ...config.storybook,
      ...(envStorybookUrl ? { url: envStorybookUrl } : {}),
    },
  };
};
