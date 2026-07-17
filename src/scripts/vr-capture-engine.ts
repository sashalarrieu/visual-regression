/**
 * Moteur de capture VR : pool global borné, cache de contextes Playwright,
 * attente stable (fonts, root visible, freeze CSS) et comparaison d'images.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";

import pixelmatch from "pixelmatch";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { PNG } from "pngjs";

import {
  DIFF_SCREENSHOT_NAME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOT_NAME,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
} from "../constants/constants";
import type { DeviceConfig, LogsType, VrConfig } from "../types/types";
import { getDevicesConfig, getProjectPaths, getProjectRoot, resolveVrConfig } from "../utils/node";
import { isDockerCaptureBackend } from "../utils/vr-capture-backend";
import { runCaptureBatchRemote } from "../utils/vr-capture-remote";
import {
  formatDiffConfirmedLog,
  formatDiffVerifyRetryLog,
  formatFlakeSuppressedLog,
  shouldRetryDiffVerification,
} from "../utils/vr-diff-verify";
import {
  appendVrCaptureParam,
  captureWithBurst,
  getStoryTags,
  NetworkQuietTracker,
  waitForStoryStable,
} from "../utils/vr-steadysnap";
import {
  getStoryDiffVerificationMaxAttempts,
  readStoryVrParameters,
  resolveEffectiveVrConfig,
  shouldUseBurstCapture,
} from "../utils/vr-story-config";
import { getStorybookMode } from "../utils/vr-storybook-runtime";

const PROJECT_ROOT = getProjectRoot();
const { publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR } = getProjectPaths(PROJECT_ROOT);

const ABSOLUTE_MAX_CONCURRENCY = 16;

/** Suppression récursive manuelle (fallback Windows ENOTEMPTY). */
const recursiveDeleteDir = (dir: string): void => {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) recursiveDeleteDir(full);
    else unlinkSync(full);
  }
  rmdirSync(dir);
};

/**
 * Supprime tous les fichiers de régressions visuelles dans public/Screenshots/.
 */
export const deleteAllVisualRegressionsFiles = (): void => {
  if (!existsSync(PUBLIC_SCREENSHOTS_DIR)) return;
  const retries = 3;
  const delayMs = 250;
  for (let i = 0; i <= retries; i++) {
    try {
      rmSync(PUBLIC_SCREENSHOTS_DIR, { recursive: true, force: true });
      return;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const retryable = err?.code === "ENOTEMPTY" || err?.code === "EBUSY" || err?.code === "EPERM";
      if (retryable && i < retries) {
        const deadline = Date.now() + delayMs;
        while (Date.now() < deadline) {
          /* busy wait */
        }
        continue;
      }
      try {
        recursiveDeleteDir(PUBLIC_SCREENSHOTS_DIR);
      } catch {
        /* échec silencieux */
      }
      return;
    }
  }
};

const stripVrScreenshotPrefix = (fileName: string): string => {
  if (fileName.startsWith(DIFF_SCREENSHOT_NAME)) return fileName.slice(DIFF_SCREENSHOT_NAME.length);
  if (fileName.startsWith(NEW_SCREENSHOT_NAME)) return fileName.slice(NEW_SCREENSHOT_NAME.length);
  if (fileName.startsWith(TEMP_SCREENSHOT_NAME)) return fileName.slice(TEMP_SCREENSHOT_NAME.length);
  return fileName;
};

const screenshotFileBelongsToDevice = (fileName: string, deviceName: string): boolean => {
  if (!fileName.endsWith(SCREENSHOT_EXTENSION)) return false;
  return stripVrScreenshotPrefix(fileName).startsWith(`${deviceName}-`);
};

const deleteDeviceScreenshotsInDir = (dir: string, deviceName: string): void => {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleteDeviceScreenshotsInDir(fullPath, deviceName);
      try {
        if (readdirSync(fullPath).length === 0) rmdirSync(fullPath);
      } catch {
        // ignore
      }
      continue;
    }

    if (!screenshotFileBelongsToDevice(entry.name, deviceName)) continue;
    try {
      rmSync(fullPath, { force: true });
    } catch (err) {
      console.warn(`⚠️  Erreur lors de la suppression de ${fullPath}:`, err);
    }
  }
};

/**
 * Supprime uniquement les artefacts VR d'un device dans public/Screenshots/ (y compris deleted/).
 */
export const deleteVisualRegressionsFilesForDevice = (deviceName: string): void => {
  if (!deviceName || !existsSync(PUBLIC_SCREENSHOTS_DIR)) return;
  deleteDeviceScreenshotsInDir(PUBLIC_SCREENSHOTS_DIR, deviceName);
};

/**
 * Args Chromium déterministes appliqués en environnement de capture reproductible
 * (Docker / Linux). Figent GPU, couleur et rendu des polices pour un rendu
 * identique quelle que soit la machine hôte.
 */
const CHROMIUM_DETERMINISTIC_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--disable-background-networking",
];

/** Options de lancement Chromium : timeout augmenté et args Windows. */
const CHROMIUM_LAUNCH_OPTIONS = {
  timeout: 300_000,
  headless: true,
  ...((process.platform === "win32" || process.platform === "linux") && {
    args: CHROMIUM_DETERMINISTIC_ARGS,
  }),
};

/** Lancement en conteneur de capture : Chromium bundlé + args déterministes. */
const DOCKER_LAUNCH_OPTIONS = {
  headless: true,
  timeout: 300_000,
  args: CHROMIUM_DETERMINISTIC_ARGS,
};

const WINDOWS_CHANNEL_LAUNCH = {
  headless: true,
  timeout: 180_000,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-background-networking",
  ],
};

export type CaptureTask = {
  storyId: string;
  deviceName: string;
  componentDir: string;
};

export type CaptureBatchOptions = {
  mode: "full" | "incremental";
  /** Vide public/Screenshots/ avant le batch (run full explicite). */
  wipePublicDir?: boolean;
  /** Supprime les fichiers VR d'une story avant recapture (régénération ciblée). */
  clearScreenshotsBeforeCapture?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  /** Supprime le log pool/timer interne (si le caller les affiche). */
  quietBatchLogs?: boolean;
};

export type CaptureStats = {
  total: number;
  completed: number;
  errors: number;
  vrs: number;
  news: number;
  durationMs: number;
};

export type CaptureBatchResult = {
  success: boolean;
  stats: CaptureStats;
  logs: LogsType;
  storiesWithDiff: string[];
  error?: string;
  /**
   * Sortie console produite pendant le batch (rempli par le daemon Docker afin
   * que l'hôte puisse rejouer les logs de capture dans la console `yarn vr`).
   */
  consoleOutput?: string[];
};

type ScreenshotPaths = {
  screenshotPath: string;
  publicScreenshotPath: string;
  newScreenshotPath: string;
  tempScreenshotPath: string;
  diffScreenshotPath: string;
};

class Semaphore {
  private available: number;
  private readonly queue: (() => void)[] = [];

  constructor(max: number) {
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.available++;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const addLogs = ({ log, type = "error", logs }: { log: string; type?: "error" | "vr" | "new"; logs: LogsType }) => {
  if (type === "new") {
    console.log(log);
    logs.news.push(log);
    return;
  }
  if (type === "vr") {
    console.warn(log);
    logs.vrs.push(log);
    return;
  }
  logs.errors.push(log);
};

/** Profil de concurrence selon le mode Storybook (dev vs static/CI). */
export type ConcurrencyProfile = "dev" | "static";

export type ResolvedConcurrency = {
  workers: number;
  profile: ConcurrencyProfile;
  /** Valeur config du profil actif (`concurrencyDev` ou `concurrency`). */
  configured: number;
  concurrency: number;
  concurrencyDev: number;
};

/**
 * Choisit le nombre de workers :
 * - Storybook **dev** → `capture.concurrencyDev` (défaut 2)
 * - Storybook **static** (local ou CI) → `capture.concurrency`
 * Puis borne par taskCount et ABSOLUTE_MAX_CONCURRENCY (16).
 */
export const resolveConcurrencyDetails = (taskCount: number, config: VrConfig): ResolvedConcurrency => {
  const profile: ConcurrencyProfile = getStorybookMode() === "dev" ? "dev" : "static";
  const configured = profile === "dev" ? config.capture.concurrencyDev : config.capture.concurrency;
  const workers = Math.min(Math.max(1, configured), taskCount, ABSOLUTE_MAX_CONCURRENCY);
  return {
    workers,
    profile,
    configured,
    concurrency: config.capture.concurrency,
    concurrencyDev: config.capture.concurrencyDev,
  };
};

export const resolveConcurrency = (taskCount: number, config: VrConfig): number =>
  resolveConcurrencyDetails(taskCount, config).workers;

const getStoryGotoWaitUntil = (): "commit" | "domcontentloaded" | "load" =>
  getStorybookMode() === "static" ? "load" : "commit";

/** Budget temps capture/stabilisation (Storybook dev + Vite peut être lent au 1er chargement). */
export const getCaptureTimeBudget = (config: VrConfig): number => {
  if (getStorybookMode() !== "dev") return config.capture.maxTestTime;
  const envMs = Number(process.env.VR_CAPTURE_DEV_TIMEOUT_MS);
  if (Number.isFinite(envMs) && envMs > 0) return envMs;
  return Math.max(config.capture.maxTestTime, 60_000);
};

/** Timeout Playwright pour page.goto (dev Storybook + Vite peut dépasser maxTestTime). */
const getStoryGotoTimeout = (config: VrConfig): number => getCaptureTimeBudget(config);

const withCaptureTimeBudget = (config: VrConfig): VrConfig => {
  const budget = getCaptureTimeBudget(config);
  return {
    ...config,
    capture: { ...config.capture, maxTestTime: budget },
    stabilize: {
      ...config.stabilize,
      maxStabilizeTime: Math.max(config.stabilize.maxStabilizeTime, budget),
    },
  };
};

const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

/** Affiche le démarrage du pool (workers + tâches + profil concurrency). */
export const logCapturePoolStart = (
  concurrencyOrDetails: number | ResolvedConcurrency,
  taskCount: number,
  mode: string,
): void => {
  if (typeof concurrencyOrDetails === "number") {
    console.log(`\n⚡️ Pool de capture : ${concurrencyOrDetails} worker(s) | ${taskCount} tâche(s) | mode ${mode}`);
    return;
  }
  const { workers, profile, concurrency, concurrencyDev } = concurrencyOrDetails;
  const profileHint =
    profile === "dev"
      ? `profil=dev · concurrencyDev=${concurrencyDev} · concurrency(static/CI)=${concurrency}`
      : `profil=static/CI · concurrency=${concurrency} · concurrencyDev=${concurrencyDev}`;
  console.log(`\n⚡️ Pool de capture : ${workers} worker(s) [${profileHint}] | ${taskCount} tâche(s) | mode ${mode}`);
};

/** Affiche la durée totale de génération. */
export const logCaptureTimerEnd = (durationMs: number, taskCount: number): void => {
  if (taskCount === 0) {
    console.log(`\n⏱️  Génération terminée en ${formatDurationMs(durationMs)} (0 tâche)`);
    return;
  }
  const avgMs = durationMs / taskCount;
  console.log(
    `\n⏱️  Génération terminée en ${formatDurationMs(durationMs)} (${taskCount} tâche(s), ~${formatDurationMs(avgMs)}/tâche)`,
  );
};

export const getStoryIframeUrl = (storybookUrl: string, storyId: string): string => {
  const base = storybookUrl.replace(/\/$/, "");
  // `serve` redirige /iframe.html → /iframe et supprime les query params (story id perdu).
  const iframePath = getStorybookMode() === "static" ? "/iframe" : "/iframe.html";
  return appendVrCaptureParam(`${base}${iframePath}?id=${encodeURIComponent(storyId)}&viewMode=story`);
};

export type CompareScreenshotOutcome = "match" | "new" | "diff" | "missing_temp";

export type CompareScreenshotResult = {
  outcome: CompareScreenshotOutcome;
  diffPixels: number;
};

export async function launchBrowser(): Promise<Browser> {
  // En conteneur de capture : toujours Chromium bundlé + args déterministes,
  // jamais Edge/Chrome système (garantit un rendu reproductible).
  if (process.env.VR_DOCKER === "1") {
    return chromium.launch(DOCKER_LAUNCH_OPTIONS);
  }
  if (process.platform === "win32") {
    const channels: ("chrome" | "msedge")[] = ["msedge", "chrome"];
    for (const channel of channels) {
      try {
        return await chromium.launch({
          channel,
          ...WINDOWS_CHANNEL_LAUNCH,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Navigateur ${channel} non disponible (${msg.slice(0, 80)}…), tentative suivante.`);
      }
    }
    console.warn("Chrome/Edge non utilisables, lancement de Chromium bundlé (peut être lent sur Windows).");
  }
  return chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
}

const normalizeComponentDir = (dir: string): string => dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

export const buildScreenshotPaths = (componentDir: string, deviceName: string, storyId: string): ScreenshotPaths => {
  const normalizedDir = normalizeComponentDir(componentDir);
  const screenshotDir = path.join(PROJECT_ROOT, normalizedDir, SCREENSHOTS_DIR);
  const publicBase = path.join(PUBLIC_SCREENSHOTS_DIR, normalizedDir);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;

  return {
    screenshotPath: path.join(screenshotDir, baseName),
    publicScreenshotPath: path.join(publicBase, baseName),
    newScreenshotPath: path.join(publicBase, `${NEW_SCREENSHOT_NAME}${baseName}`),
    tempScreenshotPath: path.join(publicBase, `${TEMP_SCREENSHOT_NAME}${baseName}`),
    diffScreenshotPath: path.join(publicBase, `${DIFF_SCREENSHOT_NAME}${baseName}`),
  };
};

/** Supprime les artefacts VR d'une story/device avant régénération. */
export const clearStoryScreenshots = (componentDir: string, deviceName: string, storyId: string): void => {
  const paths = buildScreenshotPaths(componentDir, deviceName, storyId);
  const deletedBase = path.join(PUBLIC_SCREENSHOTS_DIR, "deleted", normalizeComponentDir(componentDir));
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;

  const pathsToDelete = [
    paths.tempScreenshotPath,
    paths.diffScreenshotPath,
    paths.newScreenshotPath,
    paths.publicScreenshotPath,
    path.join(deletedBase, `${DIFF_SCREENSHOT_NAME}${baseName}`),
    path.join(deletedBase, `${NEW_SCREENSHOT_NAME}${baseName}`),
    path.join(deletedBase, `${TEMP_SCREENSHOT_NAME}${baseName}`),
    path.join(deletedBase, baseName),
  ];

  for (const filePath of pathsToDelete) {
    if (!existsSync(filePath)) continue;
    try {
      rmSync(filePath, { force: true });
    } catch (err) {
      console.warn(`⚠️  Erreur lors de la suppression de ${filePath}:`, err);
    }
  }
};

const isAllowedCaptureRequest = (requestUrl: string, storybookUrl: string): boolean => {
  if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:")) return true;

  const base = storybookUrl.replace(/\/$/, "");
  if (requestUrl.startsWith(base)) return true;

  try {
    const req = new URL(requestUrl);
    const allowed = new URL(storybookUrl);
    if (req.origin === allowed.origin) return true;
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (localHosts.has(req.hostname) && localHosts.has(allowed.hostname) && req.port === allowed.port) {
      return true;
    }
  } catch {
    // URL invalide — bloquer
  }

  return false;
};

/** Bloque les requêtes hors Storybook (analytics, CDN, etc.). */
const setupNetworkBlock = async (context: BrowserContext, storybookUrl: string): Promise<void> => {
  await context.route("**/*", route => {
    if (isAllowedCaptureRequest(route.request().url(), storybookUrl)) {
      route.continue();
    } else {
      route.abort();
    }
  });
};

const getOrCreateContext = async (
  browser: Browser,
  deviceName: string,
  deviceConfig: DeviceConfig,
  cache: Map<string, BrowserContext>,
  storybookUrl: string,
): Promise<BrowserContext> => {
  const cached = cache.get(deviceName);
  if (cached) return cached;

  const context = await browser.newContext({
    viewport: { width: deviceConfig.width, height: deviceConfig.height },
    deviceScaleFactor: deviceConfig.deviceScaleFactor,
    isMobile: deviceConfig.mobile ?? false,
  });
  await setupNetworkBlock(context, storybookUrl);
  cache.set(deviceName, context);
  return context;
};

const closeContextCache = async (cache: Map<string, BrowserContext>): Promise<void> => {
  await Promise.all([...cache.values()].map(ctx => ctx.close().catch(() => undefined)));
  cache.clear();
};

const buffersEqual = (a: Buffer, b: Buffer): boolean => {
  if (a.length !== b.length) return false;
  return a.equals(b);
};

export const compareScreenshots = ({
  storyId,
  screenshotPath,
  publicScreenshotPath,
  newScreenshotPath,
  tempScreenshotPath,
  diffScreenshotPath,
  storiesWithDiff,
  logs,
  threshold,
}: {
  storyId: string;
  screenshotPath: string;
  publicScreenshotPath: string;
  newScreenshotPath: string;
  tempScreenshotPath: string;
  diffScreenshotPath: string;
  storiesWithDiff: string[];
  logs: LogsType;
  threshold: number;
}): CompareScreenshotResult => {
  if (!existsSync(tempScreenshotPath)) {
    addLogs({ log: `🚫 No temp screenshot found for ${tempScreenshotPath}`, logs });
    return { outcome: "missing_temp", diffPixels: 0 };
  }

  if (!existsSync(screenshotPath)) {
    renameSync(tempScreenshotPath, newScreenshotPath);
    const displayPath = path.isAbsolute(screenshotPath)
      ? path.relative(PROJECT_ROOT, screenshotPath).replace(/\\/g, "/")
      : screenshotPath;
    addLogs({ log: `❇️  New screenshot for ${displayPath}`, type: "new", logs });
    return { outcome: "new", diffPixels: 0 };
  }

  const baselineBuffer = readFileSync(screenshotPath);
  const tempBuffer = readFileSync(tempScreenshotPath);

  if (buffersEqual(baselineBuffer, tempBuffer)) {
    try {
      unlinkSync(tempScreenshotPath);
    } catch {
      // ignore
    }
    console.log(`✅ No visual regression for ${storyId}`);
    return { outcome: "match", diffPixels: 0 };
  }

  const img1 = PNG.sync.read(baselineBuffer);
  const img2 = PNG.sync.read(tempBuffer);

  if (img1.width !== img2.width || img1.height !== img2.height) {
    mkdirSync(path.dirname(diffScreenshotPath), { recursive: true });
    const width = Math.max(img1.width, img2.width);
    const height = Math.max(img1.height, img2.height);
    const diff = new PNG({ width, height });
    const tmp1 = new PNG({ width, height });
    PNG.bitblt(img1, tmp1, 0, 0, img1.width, img1.height, 0, 0);
    const tmp2 = new PNG({ width, height });
    PNG.bitblt(img2, tmp2, 0, 0, img2.width, img2.height, 0, 0);
    pixelmatch(tmp1.data, tmp2.data, diff.data, width, height, { threshold });
    writeFileSync(diffScreenshotPath, PNG.sync.write(diff));
    copyFileSync(screenshotPath, publicScreenshotPath);
    if (!storiesWithDiff.includes(diffScreenshotPath)) {
      storiesWithDiff.push(diffScreenshotPath);
    }
    addLogs({ log: `⚠️  Visual regression for ${storyId} (size mismatch)`, type: "vr", logs });
    return { outcome: "diff", diffPixels: Number.MAX_SAFE_INTEGER };
  }

  const diff = new PNG({ width: img1.width, height: img1.height });
  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, { threshold });

  if (numDiffPixels > 0) {
    mkdirSync(path.dirname(diffScreenshotPath), { recursive: true });
    writeFileSync(diffScreenshotPath, PNG.sync.write(diff));
    copyFileSync(screenshotPath, publicScreenshotPath);
    if (!storiesWithDiff.includes(diffScreenshotPath)) {
      storiesWithDiff.push(diffScreenshotPath);
    }
    addLogs({ log: `⚠️  Visual regression for ${storyId} (${numDiffPixels} pixels)`, type: "vr", logs });
    return { outcome: "diff", diffPixels: numDiffPixels };
  }

  try {
    unlinkSync(tempScreenshotPath);
  } catch {
    // ignore
  }
  console.log(`✅ No visual regression for ${storyId}`);
  return { outcome: "match", diffPixels: 0 };
};

const writeStoryScreenshot = async ({
  page,
  tempScreenshotPath,
  config,
  useBurst,
}: {
  page: Page;
  tempScreenshotPath: string;
  config: VrConfig;
  useBurst: boolean;
}): Promise<void> => {
  mkdirSync(path.dirname(tempScreenshotPath), { recursive: true });
  const locator = page.locator("#storybook-root");
  if (useBurst) {
    await captureWithBurst(page, locator, config, tempScreenshotPath);
    return;
  }
  await locator.screenshot({ path: tempScreenshotPath });
};

const captureStoryScreenshot = async ({
  page,
  storyId,
  deviceName,
  tempScreenshotPath,
  storybookUrl,
  config,
  logs,
  useBurst,
  networkTracker,
  storyTags,
  skipGoto = false,
}: {
  page: Page;
  storyId: string;
  deviceName: string;
  tempScreenshotPath: string;
  storybookUrl: string;
  config: VrConfig;
  logs: LogsType;
  useBurst: boolean;
  networkTracker: NetworkQuietTracker;
  storyTags: string[];
  skipGoto?: boolean;
}): Promise<boolean> => {
  const maxTestTime = config.capture.maxTestTime;
  const timer = setTimeout(() => {
    addLogs({
      log: `⌛️ Waiting time expired for capture ${storyId} (${deviceName}) (${maxTestTime}ms)`,
      logs,
    });
  }, maxTestTime);

  try {
    if (!skipGoto) {
      networkTracker.attach(page);
      await page.goto(getStoryIframeUrl(storybookUrl, storyId), {
        waitUntil: getStoryGotoWaitUntil(),
        timeout: getStoryGotoTimeout(config),
      });
    }

    await waitForStoryStable(page, config, networkTracker, storyTags);

    const storyNotFound = await page.getByText(/Couldn't find story/i).count();
    if (storyNotFound > 0) {
      addLogs({
        log: `📸 Storybook n'a pas rendu la story ${storyId} (${deviceName}) — index Storybook vide ou story introuvable`,
        logs,
      });
      return false;
    }

    await writeStoryScreenshot({ page, tempScreenshotPath, config, useBurst });
    return true;
  } catch {
    addLogs({ log: `📸 Failed to capture screenshot for ${storyId} (${deviceName})`, logs });
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const isBrowserClosedError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return /target page, context or browser has been closed/i.test(msg) || /browser has been closed/i.test(msg);
};

const clearDiffArtifacts = ({
  paths,
  screenshotKey,
  storiesWithDiff,
  logs,
}: {
  paths: ScreenshotPaths;
  screenshotKey: string;
  storiesWithDiff: string[];
  logs: LogsType;
}): void => {
  try {
    if (existsSync(paths.tempScreenshotPath)) unlinkSync(paths.tempScreenshotPath);
    if (existsSync(paths.diffScreenshotPath)) unlinkSync(paths.diffScreenshotPath);
    const diffIdx = storiesWithDiff.indexOf(paths.diffScreenshotPath);
    if (diffIdx >= 0) storiesWithDiff.splice(diffIdx, 1);
  } catch {
    // ignore cleanup
  }
  logs.vrs = logs.vrs.filter(log => !log.includes(screenshotKey));
};

const runSingleTask = async ({
  browser,
  contextCache,
  devices,
  task,
  config,
  logs,
  storiesWithDiff,
  clearScreenshotsBeforeCapture,
}: {
  browser: Browser;
  contextCache: Map<string, BrowserContext>;
  devices: Record<string, DeviceConfig>;
  task: CaptureTask;
  config: VrConfig;
  logs: LogsType;
  storiesWithDiff: string[];
  clearScreenshotsBeforeCapture: boolean;
}): Promise<void> => {
  const captureConfig = withCaptureTimeBudget(config);
  const deviceConfig = devices[task.deviceName];
  if (!deviceConfig) {
    addLogs({ log: `⚠️  Device ${task.deviceName} not found, skipping ${task.storyId}`, logs });
    return;
  }

  if (clearScreenshotsBeforeCapture) {
    clearStoryScreenshots(task.componentDir, task.deviceName, task.storyId);
  }

  const paths = buildScreenshotPaths(task.componentDir, task.deviceName, task.storyId);
  const iframeUrl = getStoryIframeUrl(captureConfig.storybook.url, task.storyId);
  const context = await getOrCreateContext(
    browser,
    task.deviceName,
    deviceConfig,
    contextCache,
    captureConfig.storybook.url,
  );
  const page = await context.newPage();
  const networkTracker = new NetworkQuietTracker();
  const storyTags = await getStoryTags(task.storyId, captureConfig.storybook.url);
  const screenshotKey = `${task.deviceName}-${task.storyId}`;

  try {
    networkTracker.attach(page);
    await page.goto(iframeUrl, {
      waitUntil: getStoryGotoWaitUntil(),
      timeout: getStoryGotoTimeout(captureConfig),
    });

    const storyVr = await readStoryVrParameters(page, task.storyId);
    const effectiveConfig = withCaptureTimeBudget(resolveEffectiveVrConfig(captureConfig, storyVr));
    const useBurst = shouldUseBurstCapture(effectiveConfig, storyTags, storyVr);
    const maxDiffAttempts = getStoryDiffVerificationMaxAttempts(captureConfig, storyVr);

    let attempt = 1;
    let compareResult: CompareScreenshotResult = { outcome: "missing_temp", diffPixels: 0 };

    while (true) {
      const captured = await captureStoryScreenshot({
        page,
        storyId: task.storyId,
        deviceName: task.deviceName,
        tempScreenshotPath: paths.tempScreenshotPath,
        storybookUrl: captureConfig.storybook.url,
        config: effectiveConfig,
        logs,
        useBurst,
        networkTracker,
        storyTags,
        skipGoto: attempt === 1,
      });

      if (!captured) return;

      compareResult = compareScreenshots({
        storyId: screenshotKey,
        screenshotPath: paths.screenshotPath,
        publicScreenshotPath: paths.publicScreenshotPath,
        newScreenshotPath: paths.newScreenshotPath,
        tempScreenshotPath: paths.tempScreenshotPath,
        diffScreenshotPath: paths.diffScreenshotPath,
        storiesWithDiff,
        logs,
        threshold: effectiveConfig.compare.threshold,
      });

      if (!shouldRetryDiffVerification(attempt, compareResult.outcome, maxDiffAttempts)) {
        if (compareResult.outcome === "diff" && attempt >= maxDiffAttempts) {
          console.log(formatDiffConfirmedLog(maxDiffAttempts, screenshotKey));
        }
        break;
      }

      console.log(formatDiffVerifyRetryLog(attempt + 1, maxDiffAttempts, screenshotKey));
      clearDiffArtifacts({ paths, screenshotKey, storiesWithDiff, logs });
      attempt++;
    }

    if (compareResult.outcome === "match" && attempt > 1) {
      console.log(formatFlakeSuppressedLog(attempt, screenshotKey));
    }
  } finally {
    await page.close().catch(() => undefined);
  }
};

export const logCaptureTasks = (label: string, tasks: CaptureTask[]): void => {
  const byDevice = new Map<string, CaptureTask[]>();
  for (const task of tasks) {
    const list = byDevice.get(task.deviceName) ?? [];
    list.push(task);
    byDevice.set(task.deviceName, list);
  }

  console.log(`\n🔍 ${label} | Fichiers: ${tasks.length} | Devices: ${byDevice.size}`);
  for (const [deviceName, deviceTasks] of byDevice) {
    console.log(`\n  📱 Device: ${deviceName} (${deviceTasks.length} fichier${deviceTasks.length > 1 ? "s" : ""})`);
    deviceTasks.forEach((task, index) => {
      console.log(`    ${index + 1}. ${task.storyId} | ${task.componentDir}`);
    });
  }
};

export const runCaptureBatch = async (
  tasks: CaptureTask[],
  options: CaptureBatchOptions,
): Promise<CaptureBatchResult> => {
  const logs: LogsType = { errors: [], vrs: [], news: [] };
  const storiesWithDiff: string[] = [];
  const stats: CaptureStats = {
    total: tasks.length,
    completed: 0,
    errors: 0,
    vrs: 0,
    news: 0,
    durationMs: 0,
  };

  if (tasks.length === 0) {
    return { success: false, stats, logs, storiesWithDiff, error: "Aucune tâche de capture" };
  }

  const config = resolveVrConfig(PROJECT_ROOT);

  // Backend Docker (défaut) : toute capture est déléguée au daemon du sidecar.
  if (isDockerCaptureBackend(config)) {
    return runCaptureBatchRemote(tasks, options, config);
  }

  const devices = getDevicesConfig(config.devices);
  const concurrencyDetails = resolveConcurrencyDetails(tasks.length, config);
  const concurrency = options.concurrency ?? concurrencyDetails.workers;
  const contextCache = new Map<string, BrowserContext>();
  const semaphore = new Semaphore(concurrency);

  if (options.wipePublicDir) {
    deleteAllVisualRegressionsFiles();
  }

  const startedAt = performance.now();
  let browser = await launchBrowser();
  let done = 0;

  if (!options.quietBatchLogs) {
    logCapturePoolStart(
      options.concurrency !== undefined ? concurrency : concurrencyDetails,
      tasks.length,
      options.mode,
    );
  }

  try {
    await Promise.all(
      tasks.map(task =>
        semaphore.run(async () => {
          let attempt = 0;
          while (attempt < 2) {
            try {
              await runSingleTask({
                browser,
                contextCache,
                devices,
                task,
                config,
                logs,
                storiesWithDiff,
                clearScreenshotsBeforeCapture: options.clearScreenshotsBeforeCapture ?? false,
              });
              break;
            } catch (error) {
              if (isBrowserClosedError(error) && attempt === 0) {
                attempt++;
                await closeContextCache(contextCache);
                try {
                  await browser.close();
                } catch {
                  // ignore
                }
                browser = await launchBrowser();
                continue;
              }
              const errMsg = error instanceof Error ? error.message : String(error);
              addLogs({ log: `🚫 Error testing ${task.storyId} (${task.deviceName}): ${errMsg}`, logs });
              break;
            }
          }

          done++;
          stats.completed = done;
          stats.errors = logs.errors.length;
          stats.vrs = logs.vrs.length;
          stats.news = logs.news.length;
          options.onProgress?.(done, tasks.length);
        }),
      ),
    );

    stats.durationMs = Math.round(performance.now() - startedAt);
    if (!options.quietBatchLogs) {
      logCaptureTimerEnd(stats.durationMs, tasks.length);
    }

    return { success: true, stats, logs, storiesWithDiff };
  } catch (err) {
    stats.durationMs = Math.round(performance.now() - startedAt);
    if (!options.quietBatchLogs) {
      console.log(`\n⏱️  Génération interrompue après ${formatDurationMs(stats.durationMs)}`);
    }
    return {
      success: false,
      stats,
      logs,
      storiesWithDiff,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await closeContextCache(contextCache);
    await browser.close().catch(() => undefined);
  }
};
