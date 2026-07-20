/**
 * Chargement et résolution de vr.config.cjs (projet hôte).
 * Ne pas importer depuis l'app React/Expo (web).
 */
import { existsSync } from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";

import { CAPTURE_DAEMON_PORT, CAPTURE_DAEMON_URL, LOCAL_URL, STORYBOOK_PORT } from "../constants/constants";
import type {
  VrCaptureBackend,
  VrChangedFilesScope,
  VrCompareMode,
  VrConfig,
  VrConfigFile,
  VrStorybookMode,
} from "../types/types";

import { getHostSidecarPorts, SENTINEL_STORYBOOK_URL } from "./vr-sidecar-ports";

const _require = createRequire(import.meta.url);

export const VR_CONFIG_FILENAME = "vr.config.cjs";
const LEGACY_CONFIG_FILENAME = "vr-devices.config.cjs";

const DEFAULT_STORYBOOK_URL = SENTINEL_STORYBOOK_URL;
const DEFAULT_REMOTE_CHUNK_SIZE = 20;
const DEFAULT_DOCKER_IMAGE = "vr-capture:1.61.1";
const DEFAULT_PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.61.1-jammy";

const DEFAULT_GLOBAL_TRIGGERS = [
  ".storybook/**",
  "package.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "vr.config.cjs",
];

/** Défaut static/CI : borné par le nombre de CPU (max 8). */
const defaultConcurrency = (): number => Math.max(2, Math.min(os.cpus().length, 8));

/** Défaut Storybook dev : bas pour ne pas saturer Vite/HMR. */
const DEFAULT_CONCURRENCY_DEV = 2;

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

const parseEnvCaptureBackend = (): VrCaptureBackend | undefined => {
  const raw = (process.env.VR_CAPTURE_BACKEND || "").toLowerCase();
  if (raw === "docker" || raw === "local") return raw;
  return undefined;
};

const parseEnvStorybookMode = (): VrStorybookMode | undefined => {
  const value = (process.env.VR_STORYBOOK_MODE || "").toLowerCase();
  if (value === "static" || value === "dev") return value;
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

const parseEnvShardIndex = (): number | undefined => {
  const raw = process.env.VR_SHARD_INDEX;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

const parseEnvShardTotal = (): number | undefined => {
  const raw = process.env.VR_SHARD_TOTAL;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

const mergeVrConfig = (fileConfig: VrConfigFile, defaults: VrConfig): VrConfig => ({
  devices: fileConfig.devices ?? defaults.devices,
  capture: { ...defaults.capture, ...fileConfig.capture },
  compare: { ...defaults.compare, ...fileConfig.compare },
  launcher: { ...defaults.launcher, ...fileConfig.launcher },
  storybook: { ...defaults.storybook, ...fileConfig.storybook },
  stabilize: { ...defaults.stabilize, ...fileConfig.stabilize },
  docker: { ...defaults.docker, ...fileConfig.docker },
});

export const getDefaultVrConfig = (): VrConfig => ({
  devices: [],
  capture: {
    concurrency: defaultConcurrency(),
    concurrencyDev: DEFAULT_CONCURRENCY_DEV,
    maxTestTime: 10_000,
    remoteChunkSize: DEFAULT_REMOTE_CHUNK_SIZE,
    backend: "docker",
    daemonUrl: CAPTURE_DAEMON_URL,
  },
  compare: {
    mode: "incremental",
    base: "origin/main",
    scope: "all",
    includeWorkingTree: true,
    threshold: 0,
    diffVerificationMaxAttempts: 3,
    globalTriggers: [...DEFAULT_GLOBAL_TRIGGERS],
    statsFile: "storybook-static/preview-stats.json",
    manifestPath: ".vr-cache/manifest.json",
  },
  launcher: {
    runInitialCompare: true,
    forceStaticRebuild: false,
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
    maxStabilizeTime: 5_000,
  },
  docker: {
    image: DEFAULT_DOCKER_IMAGE,
    playwrightImage: DEFAULT_PLAYWRIGHT_IMAGE,
    showLogs: false,
  },
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
      `   Voir la documentation : https://github.com/sashalarrieu/visual-regression#readme\n`,
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

  const fileConfig = normalizeVrConfigFile(raw as VrConfigFile & { launcher?: Record<string, unknown> });
  if (!Array.isArray(fileConfig.devices) || fileConfig.devices.length === 0) {
    console.error(`\n❌ Le fichier ${VR_CONFIG_FILENAME} doit définir un tableau "devices" non vide.\n`);
    process.exit(1);
  }

  return mergeVrConfig(fileConfig, getDefaultVrConfig());
};

/**
 * Normalise les clés legacy du fichier (ex. `launcher.storybookStatic` → `storybookMode`).
 * Sans muter le require cache : on clone la section launcher.
 */
const normalizeVrConfigFile = (raw: VrConfigFile & { launcher?: Record<string, unknown> }): VrConfigFile => {
  const launcherRaw = raw.launcher;
  if (!launcherRaw || typeof launcherRaw !== "object") return raw;

  const { storybookStatic, ...rest } = launcherRaw;
  if (storybookStatic === undefined) return raw;

  const mappedMode: VrStorybookMode | undefined =
    rest.storybookMode === "static" || rest.storybookMode === "dev"
      ? rest.storybookMode
      : storybookStatic === true
        ? "static"
        : storybookStatic === false
          ? "dev"
          : undefined;

  if (mappedMode !== undefined && rest.storybookMode === undefined) {
    console.warn(
      `⚠️  [vr-config] launcher.storybookStatic est déprécié — utilisez launcher.storybookMode: "${mappedMode}".`,
    );
  }

  return {
    ...raw,
    launcher: {
      ...rest,
      ...(mappedMode !== undefined && rest.storybookMode === undefined ? { storybookMode: mappedMode } : {}),
    },
  };
};

/** Applique les overrides VR_* (env > config fichier). */
export const applyEnvOverridesToVrConfig = (config: VrConfig): VrConfig => {
  const envConcurrency = parsePositiveEnv(process.env.VR_CONCURRENCY);
  const envConcurrencyDev =
    parsePositiveEnv(process.env.VR_CONCURRENCY_DEV) ?? parsePositiveEnv(process.env.VR_CAPTURE_DEV_CONCURRENCY);
  const envMaxTestTime = parsePositiveEnv(process.env.VR_MAX_TEST_TIME);
  const envRemoteChunkSize = parsePositiveEnv(process.env.VR_CAPTURE_REMOTE_CHUNK);
  const envCaptureBackend = parseEnvCaptureBackend();
  const envDaemonUrl = process.env.VR_CAPTURE_DAEMON_URL?.trim();
  const envThreshold = process.env.VR_THRESHOLD !== undefined ? Number(process.env.VR_THRESHOLD) : undefined;
  const compareMode = parseEnvCompareMode();
  const compareScope = parseEnvCompareScope();
  const envCompareBase = process.env.VR_COMPARE_BASE;
  const envStorybookUrl = process.env.VR_STORYBOOK_URL;
  const envRunInitialCompare = envBool(process.env.VR_RUN_INITIAL_COMPARE);
  const envStorybookStatic = envBool(process.env.VR_STORYBOOK_STATIC);
  const envStorybookMode = parseEnvStorybookMode();
  const envForceStaticRebuild = envBool(process.env.VR_STORYBOOK_STATIC_REBUILD);
  const envDiffVerifyMaxAttempts = parsePositiveEnv(process.env.VR_DIFF_VERIFY_MAX_ATTEMPTS);
  const envShardIndex = parseEnvShardIndex();
  const envShardTotal = parseEnvShardTotal();
  const envDockerImage = process.env.VR_DOCKER_IMAGE?.trim();
  const envPlaywrightImage = process.env.VR_PLAYWRIGHT_IMAGE?.trim();
  const envDockerShowLogs = envBool(process.env.VR_DOCKER_SHOW_LOGS);

  const storybookMode =
    envStorybookMode ??
    (envStorybookStatic === true ? "static" : envStorybookStatic === false ? "dev" : config.launcher.storybookMode);

  return {
    ...config,
    capture: {
      ...config.capture,
      ...(envConcurrency !== undefined ? { concurrency: envConcurrency } : {}),
      ...(envConcurrencyDev !== undefined ? { concurrencyDev: envConcurrencyDev } : {}),
      ...(envMaxTestTime !== undefined ? { maxTestTime: envMaxTestTime } : {}),
      ...(envRemoteChunkSize !== undefined ? { remoteChunkSize: envRemoteChunkSize } : {}),
      ...(envCaptureBackend !== undefined ? { backend: envCaptureBackend } : {}),
      ...(envDaemonUrl ? { daemonUrl: envDaemonUrl.replace(/\/$/, "") } : {}),
    },
    compare: {
      ...config.compare,
      ...(compareMode !== undefined ? { mode: compareMode } : {}),
      ...(compareScope !== undefined ? { scope: compareScope } : {}),
      ...(envCompareBase ? { base: envCompareBase } : {}),
      ...(envThreshold !== undefined && Number.isFinite(envThreshold) ? { threshold: envThreshold } : {}),
      ...(envDiffVerifyMaxAttempts !== undefined ? { diffVerificationMaxAttempts: envDiffVerifyMaxAttempts } : {}),
      ...(envShardIndex !== undefined ? { shardIndex: envShardIndex } : {}),
      ...(envShardTotal !== undefined ? { shardTotal: envShardTotal } : {}),
    },
    launcher: {
      ...config.launcher,
      ...(envRunInitialCompare !== undefined ? { runInitialCompare: envRunInitialCompare } : {}),
      ...(storybookMode !== undefined ? { storybookMode } : {}),
      ...(envForceStaticRebuild !== undefined ? { forceStaticRebuild: envForceStaticRebuild } : {}),
    },
    storybook: {
      ...config.storybook,
      ...(envStorybookUrl ? { url: envStorybookUrl } : {}),
    },
    docker: {
      ...config.docker,
      ...(envDockerImage ? { image: envDockerImage } : {}),
      ...(envPlaywrightImage ? { playwrightImage: envPlaywrightImage } : {}),
      ...(envDockerShowLogs !== undefined ? { showLogs: envDockerShowLogs } : {}),
    },
  };
};

/** Fusion fichier vr.config (tests unitaires). */
export const mergeVrConfigFile = (fileConfig: VrConfigFile, defaults: VrConfig = getDefaultVrConfig()): VrConfig =>
  mergeVrConfig(fileConfig, defaults);

/**
 * Ports Storybook/daemon :
 * - Dans le conteneur (VR_DOCKER=1) : toujours 6006 / 2810 (écoute interne).
 * - Sur l'hôte : ports dérivés du projectRoot si sentinelles ; overrides custom respectés.
 */
export const applySidecarPortResolution = (config: VrConfig, projectRoot: string): VrConfig => {
  if (process.env.VR_DOCKER === "1") {
    return {
      ...config,
      storybook: { ...config.storybook, url: `${LOCAL_URL}:${STORYBOOK_PORT}` },
      capture: { ...config.capture, daemonUrl: `${LOCAL_URL}:${CAPTURE_DAEMON_PORT}` },
    };
  }

  // Backend local sur l'hôte : Storybook tourne souvent déjà sur 6006 — ne pas dériver.
  if (config.capture.backend === "local") {
    return config;
  }

  const hostPorts = getHostSidecarPorts(projectRoot, {
    storybookUrl: config.storybook.url,
    daemonUrl: config.capture.daemonUrl,
  });

  return {
    ...config,
    storybook: { ...config.storybook, url: hostPorts.storybookUrl },
    capture: { ...config.capture, daemonUrl: hostPorts.daemonUrl },
  };
};

/**
 * Propage `storybook.configDir` → `SBCONFIG_CONFIG_DIR` si l'env n'est pas déjà définie.
 * Monorepos : un seul `vr.config.cjs` suffit, sans préfixer chaque script.
 */
export const applyStorybookConfigDirEnv = (projectRoot: string, config: VrConfig): void => {
  if (process.env.SBCONFIG_CONFIG_DIR?.trim()) return;
  const dir = config.storybook.configDir?.trim();
  if (!dir) return;
  process.env.SBCONFIG_CONFIG_DIR = path.isAbsolute(dir) ? dir : path.resolve(projectRoot, dir);
};

/** Résolution finale : env var (VR_*) > vr.config.cjs > défauts package (+ ports sidecar). */
export const resolveVrConfig = (root?: string): VrConfig => {
  const projectRoot = root ?? path.resolve(process.env.VR_PROJECT_ROOT || process.cwd());
  const config = applySidecarPortResolution(applyEnvOverridesToVrConfig(loadVrConfig(projectRoot)), projectRoot);
  applyStorybookConfigDirEnv(projectRoot, config);
  return config;
};
