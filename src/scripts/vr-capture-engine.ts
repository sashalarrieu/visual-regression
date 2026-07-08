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

import type { DeviceConfig, LogsType, VrConfig } from "@app-types/types";
import {
  DIFF_SCREENSHOT_NAME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOT_NAME,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
} from "@constants/constants";
import { getDevicesConfig, getProjectPaths, getProjectRoot, resolveVrConfig } from "@utils/node";
import {
  formatDiffConfirmedLog,
  formatDiffVerifyRetryLog,
  formatFlakeSuppressedLog,
  shouldRetryDiffVerification,
} from "@utils/vr-diff-verify";
import {
  appendVrCaptureParam,
  captureWithBurst,
  getStoryTags,
  NetworkQuietTracker,
  waitForStoryStable,
} from "@utils/vr-steadysnap";
import {
  getStoryDiffVerificationMaxAttempts,
  readStoryVrParameters,
  resolveEffectiveVrConfig,
  shouldUseBurstCapture,
} from "@utils/vr-story-config";

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

/** Options de lancement Chromium : timeout augmenté et args Windows. */
const CHROMIUM_LAUNCH_OPTIONS = {
  timeout: 300_000,
  headless: true,
  ...(process.platform === "win32" && {
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  }),
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

export const resolveConcurrency = (taskCount: number, config: VrConfig): number => {
  const requested = config.capture.concurrency;
  return Math.min(Math.max(1, requested), taskCount, ABSOLUTE_MAX_CONCURRENCY);
};

const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

/** Affiche le démarrage du pool (workers + tâches). */
export const logCapturePoolStart = (concurrency: number, taskCount: number, mode: string): void => {
  console.log(`\n⚡ Pool de capture : ${concurrency} worker(s) | ${taskCount} tâche(s) | mode ${mode}`);
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

export const getStoryIframeUrl = (storybookUrl: string, storyId: string): string =>
  appendVrCaptureParam(`${storybookUrl.replace(/\/$/, "")}/iframe.html?id=${storyId}&viewMode=story`);

export type CompareScreenshotOutcome = "match" | "new" | "diff" | "missing_temp";

export type CompareScreenshotResult = {
  outcome: CompareScreenshotOutcome;
  diffPixels: number;
};

export async function launchBrowser(): Promise<Browser> {
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
  const screenshotDir = path.join(normalizedDir, SCREENSHOTS_DIR);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;

  return {
    screenshotPath: path.join(screenshotDir, baseName),
    publicScreenshotPath: path.join(PUBLIC_SCREENSHOTS_DIR, normalizedDir, baseName),
    newScreenshotPath: path.join(PUBLIC_SCREENSHOTS_DIR, normalizedDir, `${NEW_SCREENSHOT_NAME}${baseName}`),
    tempScreenshotPath: path.join(PUBLIC_SCREENSHOTS_DIR, normalizedDir, `${TEMP_SCREENSHOT_NAME}${baseName}`),
    diffScreenshotPath: path.join(PUBLIC_SCREENSHOTS_DIR, normalizedDir, `${DIFF_SCREENSHOT_NAME}${baseName}`),
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
    addLogs({ log: `❇️  New screenshot for ${screenshotPath}`, type: "new", logs });
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
      await page.goto(getStoryIframeUrl(storybookUrl, storyId), { waitUntil: "load", timeout: maxTestTime });
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
  const deviceConfig = devices[task.deviceName];
  if (!deviceConfig) {
    addLogs({ log: `⚠️  Device ${task.deviceName} not found, skipping ${task.storyId}`, logs });
    return;
  }

  if (clearScreenshotsBeforeCapture) {
    clearStoryScreenshots(task.componentDir, task.deviceName, task.storyId);
  }

  const paths = buildScreenshotPaths(task.componentDir, task.deviceName, task.storyId);
  const context = await getOrCreateContext(browser, task.deviceName, deviceConfig, contextCache, config.storybook.url);
  const page = await context.newPage();
  const networkTracker = new NetworkQuietTracker();
  const storyTags = await getStoryTags(task.storyId, config.storybook.url);
  const screenshotKey = `${task.deviceName}-${task.storyId}`;

  try {
    networkTracker.attach(page);
    await page.goto(getStoryIframeUrl(config.storybook.url, task.storyId), {
      waitUntil: "load",
      timeout: config.capture.maxTestTime,
    });

    const storyVr = await readStoryVrParameters(page, task.storyId);
    const effectiveConfig = resolveEffectiveVrConfig(config, storyVr);
    const useBurst = shouldUseBurstCapture(effectiveConfig, storyTags, storyVr);
    const maxDiffAttempts = getStoryDiffVerificationMaxAttempts(config, storyVr);

    let attempt = 1;
    let compareResult: CompareScreenshotResult = { outcome: "missing_temp", diffPixels: 0 };

    while (true) {
      const captured = await captureStoryScreenshot({
        page,
        storyId: task.storyId,
        deviceName: task.deviceName,
        tempScreenshotPath: paths.tempScreenshotPath,
        storybookUrl: config.storybook.url,
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
  const devices = getDevicesConfig(config.devices);
  const concurrency = options.concurrency ?? resolveConcurrency(tasks.length, config);
  const contextCache = new Map<string, BrowserContext>();
  const semaphore = new Semaphore(concurrency);

  if (options.wipePublicDir) {
    deleteAllVisualRegressionsFiles();
  }

  const startedAt = performance.now();
  let browser = await launchBrowser();
  let done = 0;

  if (!options.quietBatchLogs) {
    logCapturePoolStart(concurrency, tasks.length, options.mode);
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
