// scripts/compare-visual-regressions.ts (package @setshao/visual-regression)
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";

import {
  DIFF_SCREENSHOT_NAME,
  FORCE_VR_TAG,
  IGNORE_VR_TAG,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOT_NAME,
} from "../constants/constants";
import type { StoryDevicePair } from "../types/types";
import {
  getDevicesConfig,
  getProjectPaths,
  getProjectRoot,
  resolveVrConfig,
  waitForStorybookHostReady,
} from "../utils/node";
import { getCaptureBackend, isDockerCaptureBackend } from "../utils/vr-capture-backend";
import { filterCaptureTasks, getChangedFiles, shouldWipePublicDir, updateManifest } from "../utils/vr-incremental";
import { filterTasksByShard, parseShardConfig } from "../utils/vr-sharding";

import type { CaptureTask } from "./vr-capture-engine";
import {
  deleteAllVisualRegressionsFiles,
  deleteVisualRegressionsFilesForDevice,
  formatDurationMs,
  logCapturePoolStart,
  logCaptureTasks,
  logCaptureTimerEnd,
  resolveConcurrencyDetails,
  runCaptureBatch,
} from "./vr-capture-engine";

export { deleteAllVisualRegressionsFiles, deleteVisualRegressionsFilesForDevice } from "./vr-capture-engine";

const PROJECT_ROOT = getProjectRoot();
const { publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR } = getProjectPaths(PROJECT_ROOT);
const getDevices = () => getDevicesConfig(resolveVrConfig(PROJECT_ROOT).devices);

/** Entrée story telle que renvoyée par Storybook (index.json). */
type StoryIndexEntry = {
  id: string;
  type?: string;
  importPath: string;
  title?: string;
  name?: string;
  tags?: string[];
};

const shouldIncludeStoryForVisualRegression = (entry: StoryIndexEntry): boolean => {
  if (entry.type !== "story") return false;
  if (entry.id?.endsWith("--docs")) return false;

  const tags = entry.tags ?? [];
  return tags.includes(FORCE_VR_TAG) || !tags.includes(IGNORE_VR_TAG);
};

type StorybookIndexEntries = Record<string, StoryIndexEntry>;

let cachedStorybookEntries: StorybookIndexEntries | null = null;
let cachedStorybookEntriesAt = 0;
const STORYBOOK_INDEX_CACHE_MS = 5000;

const normalizeComponentDir = (dir: string): string => dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

const getStorybookUrl = (): string => resolveVrConfig(PROJECT_ROOT).storybook.url;

const fetchStorybookIndexEntries = async (): Promise<StorybookIndexEntries> => {
  const now = Date.now();
  if (cachedStorybookEntries && now - cachedStorybookEntriesAt < STORYBOOK_INDEX_CACHE_MS) {
    return cachedStorybookEntries;
  }
  const res = await fetch(`${getStorybookUrl()}/index.json`);
  if (!res.ok) return cachedStorybookEntries ?? {};
  const data = (await res.json()) as { entries?: StorybookIndexEntries };
  cachedStorybookEntries = data.entries ?? {};
  cachedStorybookEntriesAt = now;
  return cachedStorybookEntries;
};

const fetchStoriesFromStorybookIndex = async (): Promise<StoryIndexEntry[]> => {
  const entries = await fetchStorybookIndexEntries();
  return Object.values(entries).filter(
    entry => shouldIncludeStoryForVisualRegression(entry) && Boolean(entry.importPath),
  );
};

const findComponentDirInScreenshots = (storyId: string, deviceName: string): string | null => {
  const needle = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
  const dirsToScan = [PUBLIC_SCREENSHOTS_DIR, path.join(PUBLIC_SCREENSHOTS_DIR, "deleted")];

  const scanDir = (currentDir: string): string | null => {
    if (!existsSync(currentDir)) return null;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const found = scanDir(fullPath);
        if (found) return found;
        continue;
      }
      if (!entry.name.endsWith(SCREENSHOT_EXTENSION)) continue;
      if (!entry.name.includes(needle)) continue;
      const relative = path.relative(PUBLIC_SCREENSHOTS_DIR, path.dirname(fullPath)).replace(/\\/g, "/");
      return relative === "" ? null : relative;
    }
    return null;
  };

  for (const root of dirsToScan) {
    const found = scanDir(root);
    if (found) return found;
  }
  return null;
};

const resolveComponentDir = async (
  storyId: string,
  deviceName: string,
  componentDirHint?: string,
): Promise<string | null> => {
  if (componentDirHint) return normalizeComponentDir(componentDirHint);

  const entries = await fetchStorybookIndexEntries();
  const story = entries[storyId];
  if (story?.importPath) return normalizeComponentDir(path.dirname(story.importPath));

  return findComponentDirInScreenshots(storyId, deviceName);
};

const getAllStories = async (): Promise<StoryIndexEntry[]> => fetchStoriesFromStorybookIndex();

const buildTasksForAllStories = async (deviceFilter?: string): Promise<CaptureTask[]> => {
  const stories = await getAllStories();
  const devices = Object.keys(getDevices());
  const devicesToProcess = deviceFilter ? [deviceFilter] : devices;
  const tasks: CaptureTask[] = [];

  for (const deviceName of devicesToProcess) {
    if (!getDevices()[deviceName]) continue;
    for (const story of stories) {
      tasks.push({
        storyId: story.id,
        deviceName,
        componentDir: normalizeComponentDir(path.dirname(story.importPath)),
      });
    }
  }

  return tasks;
};

const buildTasksFromSelection = async (storiesToCompare: StoryDevicePair[]): Promise<CaptureTask[]> => {
  const tasks: CaptureTask[] = [];
  const devices = getDevices();

  for (const { storyId, deviceName, componentDir: componentDirHint } of storiesToCompare) {
    if (!devices[deviceName]) {
      console.warn(`⚠️  Device ${deviceName} not found, skipping ${storyId}`);
      continue;
    }
    const componentDir = await resolveComponentDir(storyId, deviceName, componentDirHint);
    if (!componentDir) {
      console.warn(`⚠️  Story ${storyId} introuvable (index Storybook + disque), skipping`);
      continue;
    }
    tasks.push({ storyId, deviceName, componentDir });
  }

  return tasks;
};

const extractDeviceAndStoryIdFromDeletedFile = (
  fileName: string,
  allDevices: string[],
): { deviceName: string | null; storyId: string | null; prefix: string | null } => {
  const fileNameWithoutExt = fileName.replace(SCREENSHOT_EXTENSION, "");
  let prefix: string | null = null;
  let fileNameWithoutPrefix = fileNameWithoutExt;

  if (fileNameWithoutExt.startsWith(NEW_SCREENSHOT_NAME)) {
    prefix = NEW_SCREENSHOT_NAME;
    fileNameWithoutPrefix = fileNameWithoutExt.substring(NEW_SCREENSHOT_NAME.length);
  } else if (fileNameWithoutExt.startsWith(DIFF_SCREENSHOT_NAME)) {
    prefix = DIFF_SCREENSHOT_NAME;
    fileNameWithoutPrefix = fileNameWithoutExt.substring(DIFF_SCREENSHOT_NAME.length);
  } else {
    return { deviceName: null, storyId: null, prefix: null };
  }

  fileNameWithoutPrefix = fileNameWithoutPrefix.replace(SCREENSHOT_NAME.replace(SCREENSHOT_EXTENSION, ""), "");

  for (const device of allDevices) {
    if (fileNameWithoutPrefix.startsWith(`${device}-`)) {
      return {
        deviceName: device,
        storyId: fileNameWithoutPrefix.substring(device.length + 1),
        prefix,
      };
    }
  }

  return { deviceName: null, storyId: null, prefix: null };
};

const buildTasksFromDeletedByType = async (
  type: "new" | "diff" | "rejected",
  deviceName?: string,
): Promise<CaptureTask[]> => {
  const stories = await getAllStories();
  const allDevices = Object.keys(getDevices());
  const deletedDir = path.join(PUBLIC_SCREENSHOTS_DIR, "deleted");
  const tasks: CaptureTask[] = [];

  if (!existsSync(deletedDir)) return tasks;

  const scanDeletedDir = (dir: string) => {
    try {
      for (const file of readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          scanDeletedDir(fullPath);
          continue;
        }

        if (!file.endsWith(SCREENSHOT_EXTENSION)) continue;

        const { deviceName: foundDevice, storyId, prefix } = extractDeviceAndStoryIdFromDeletedFile(file, allDevices);
        if (!foundDevice || !storyId || !prefix) continue;

        const isNewFile = prefix === NEW_SCREENSHOT_NAME;
        const isDiffFile = prefix === DIFF_SCREENSHOT_NAME;
        let shouldInclude = false;
        if (type === "new" && isNewFile) shouldInclude = true;
        else if (type === "diff" && isDiffFile) shouldInclude = true;
        else if (type === "rejected" && (isNewFile || isDiffFile)) shouldInclude = true;
        if (!shouldInclude) continue;
        if (deviceName && foundDevice !== deviceName) continue;

        const story = stories.find(s => s.id === storyId);
        if (!story) continue;

        tasks.push({
          storyId,
          deviceName: foundDevice,
          componentDir: normalizeComponentDir(path.dirname(story.importPath)),
        });
      }
    } catch (err) {
      console.log(
        `🚫 Erreur lors de la lecture du dossier deleted : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  scanDeletedDir(deletedDir);
  return tasks;
};

const printLogsSummary = (
  logs: { errors: string[]; vrs: string[]; news: string[] },
  options?: { durationMs?: number },
): void => {
  const nbErrors = logs.errors.length;
  if (nbErrors) {
    console.log(`\n\n   ============================`);
    console.log(`🚫  Errors (${nbErrors})`);
    console.log(`   ========= ERRORS ===========`);
    if (nbErrors <= 15) {
      logs.errors.forEach(log => console.error(log));
    } else {
      const byMessage = new Map<string, number>();
      for (const log of logs.errors) {
        const idx = log.indexOf(": ");
        const msg = idx >= 0 ? log.slice(idx + 2).slice(0, 100) : log;
        byMessage.set(msg, (byMessage.get(msg) ?? 0) + 1);
      }
      [...byMessage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .forEach(([msg, count]) => console.error(`  ×${count} ${msg}${msg.length >= 100 ? "…" : ""}`));
    }
  }

  const nbVisualRegressions = logs.vrs.length;
  if (nbVisualRegressions) {
    console.error(`\n\n   ============================`);
    console.error(`⚠️  Visual tests failed : ${nbVisualRegressions}`);
    console.error(`   ============ VR ============`);
    logs.vrs.forEach(log => console.error(log));
  }

  const nbNewScreenshot = logs.news.length;
  if (nbNewScreenshot) {
    console.log(`\n\n   ============================`);
    console.log(`❇️  New screenshots : ${nbNewScreenshot}`);
    console.log(`   ========== NEW =============`);
    logs.news.forEach(log => console.log(log));
  }

  const durationMs = options?.durationMs;
  console.log(`\n\n   ============================`);
  console.error(`⚠️  Visual tests failed : ${nbVisualRegressions}`);
  console.log(`❇️  New screenshots : ${nbNewScreenshot}`);
  console.error(`🚫  Capture errors : ${nbErrors}`);
  if (durationMs !== undefined) {
    console.log(`⏱️  Total duration : ${formatDurationMs(durationMs)}`);
  }
};

/**
 * Régénère une sélection de stories (storyId + deviceName).
 */
export const compareSelectedStories = async (
  storiesToCompare: StoryDevicePair[],
): Promise<{ success: boolean; error?: string }> => {
  const tasks = await buildTasksFromSelection(storiesToCompare);
  if (tasks.length === 0) {
    console.log(`\n🚫 Aucun fichier à régénérer pour la sélection`);
    return { success: false, error: "Aucune story résolue pour la régénération" };
  }

  logCaptureTasks("Sélection", tasks);
  const result = await runCaptureBatch(tasks, {
    mode: "full",
    clearScreenshotsBeforeCapture: true,
  });
  return { success: result.success, error: result.error };
};

export const compareSingleStory = async (
  storyId: string,
  deviceName: string,
  componentDir?: string,
): Promise<{ success: boolean; error?: string }> => compareSelectedStories([{ storyId, deviceName, componentDir }]);

export type CompareAllStoriesOptions = {
  onDirectoryWiped?: () => void;
};

export const compareAllStories = async (
  deviceName?: string,
  options?: CompareAllStoriesOptions,
): Promise<{ success: boolean; error?: string }> => {
  if (deviceName) {
    deleteVisualRegressionsFilesForDevice(deviceName);
  } else {
    deleteAllVisualRegressionsFiles();
  }
  options?.onDirectoryWiped?.();

  const tasks = await buildTasksForAllStories(deviceName);
  logCaptureTasks(`Régénération complète | Device: ${deviceName || "all"}`, tasks);

  if (tasks.length === 0) {
    console.log(`\n🚫 Aucun fichier à régénérer${deviceName ? ` pour le device "${deviceName}"` : ""}`);
    return { success: true };
  }

  const result = await runCaptureBatch(tasks, {
    mode: "full",
    wipePublicDir: false,
  });
  return { success: result.success, error: result.error };
};

export const compareByType = async (
  type: "new" | "diff" | "rejected",
  deviceName?: string,
): Promise<{ success: boolean; error?: string }> => {
  const tasks = await buildTasksFromDeletedByType(type, deviceName);
  logCaptureTasks(`Type: "${type}" | Device: ${deviceName || "all"}`, tasks);

  if (tasks.length === 0) {
    console.log(
      `\n🚫 Aucun fichier à régénérer pour le type "${type}"${deviceName ? ` sur le device "${deviceName}"` : ""}`,
    );
    return { success: true };
  }

  const result = await runCaptureBatch(tasks, {
    mode: "full",
    clearScreenshotsBeforeCapture: true,
  });
  return { success: result.success, error: result.error };
};

const compareVisualRegressions = async () => {
  if (process.stdout.writable) {
    process.stdout.write("\n🔍 [VR] Comparaison en cours…\n");
  }

  const config = resolveVrConfig(PROJECT_ROOT);
  const storybookUrl = config.storybook.url;

  const storybookReady = await waitForStorybookHostReady(1, 30, PROJECT_ROOT);
  if (!storybookReady.ready) {
    console.error(
      `\n❌ Storybook (${storybookUrl}) n'est pas accessible depuis l'hôte.\n` +
        "   Attendez le forward Docker (port 6006) ou relancez Storybook (pnpm vr / pnpm storybook).\n",
    );
    process.exit(1);
  }

  const stories = await getAllStories();

  if (stories.length === 0) {
    console.log(`🚫 No stories found`);
    process.exit(0);
  }

  const devices = getDevices();
  const allTasks: CaptureTask[] = [];
  for (const story of stories) {
    for (const deviceName of Object.keys(devices)) {
      allTasks.push({
        storyId: story.id,
        deviceName,
        componentDir: normalizeComponentDir(path.dirname(story.importPath)),
      });
    }
  }

  const compareMode = config.compare.mode;
  const changedFiles = getChangedFiles(PROJECT_ROOT, config);

  if (changedFiles.source === "git" && changedFiles.files.length > 0) {
    console.log(`\n📂 ${changedFiles.files.length} fichier(s) modifié(s) (${changedFiles.source})`);
    changedFiles.files.slice(0, 10).forEach(f => console.log(`   • ${f}`));
    if (changedFiles.files.length > 10) {
      console.log(`   … et ${changedFiles.files.length - 10} autre(s)`);
    }
  } else if (changedFiles.source === "manifest" && changedFiles.files.length > 0) {
    console.log(`\n📂 ${changedFiles.files.length} fichier(s) modifié(s) (manifest)`);
  } else if (changedFiles.source === "git" && changedFiles.files.length === 0) {
    console.log(`\n📂 Aucun fichier modifié détecté (git)`);
  }

  const {
    tasks: incrementalTasks,
    skipped,
    reason,
  } = filterCaptureTasks(allTasks, config, stories, {
    projectRoot: PROJECT_ROOT,
    publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR,
    changedFiles,
  });

  const { tasks, skipped: shardSkipped } = filterTasksByShard(incrementalTasks, parseShardConfig(config));
  const totalSkipped = skipped + shardSkipped;

  const wipePublicDir = shouldWipePublicDir(config, { tasks, skipped: totalSkipped, reason });

  if (reason === "incremental") {
    console.log(
      `\n📦 Mode incrémental : ${tasks.length}/${allTasks.length} tâche(s) à capturer (${totalSkipped} skipped)`,
    );
  }

  console.log(
    `🐍 ${stories.length} stories × ${Object.keys(devices).length} devices = ${allTasks.length} screenshots | mode ${compareMode}${reason === "global-trigger" ? " (global trigger → full)" : ""}`,
  );

  if (tasks.length === 0) {
    console.log("\n✅ Aucune capture nécessaire — tout est à jour.");
    logCaptureTimerEnd(0, 0);
    process.exit(0);
  }

  const batchMode = compareMode === "full" || reason === "global-trigger" ? "full" : "incremental";
  const concurrencyDetails = resolveConcurrencyDetails(tasks.length, config);
  logCapturePoolStart(concurrencyDetails, tasks.length, batchMode);

  if (isDockerCaptureBackend(config)) {
    console.log(`🐳 Backend capture: ${getCaptureBackend(config)} (délégation au sidecar Docker)`);
  }

  const result = await runCaptureBatch(tasks, {
    mode: batchMode,
    wipePublicDir,
    concurrency: concurrencyDetails.workers,
    quietBatchLogs: true,
  });

  logCaptureTimerEnd(result.stats.durationMs, tasks.length);

  if (!result.success || result.error) {
    console.error(`\n❌ Échec de la capture: ${result.error ?? "erreur inconnue"}`);
    printLogsSummary(result.logs, { durationMs: result.stats.durationMs });
    process.exit(1);
  }

  if (tasks.length > 0 && result.stats.completed === 0 && result.stats.durationMs < 100) {
    console.error(
      `\n❌ Aucune capture n'a été exécutée (${tasks.length} tâche(s) planifiées, durée ${result.stats.durationMs} ms).`,
    );
    console.error("   Vérifiez que le daemon Docker tourne (pnpm vr:capture:status) et que Storybook répond.");
    printLogsSummary(result.logs, { durationMs: result.stats.durationMs });
    process.exit(1);
  }

  updateManifest(PROJECT_ROOT, config);

  printLogsSummary(result.logs, { durationMs: result.stats.durationMs });

  const nbErrors = result.logs.errors.length;
  const nbVisualRegressions = result.logs.vrs.length;
  const nbNewScreenshot = result.logs.news.length;

  if (nbErrors > 0 || nbVisualRegressions > 0) {
    process.exit(nbVisualRegressions > 0 ? 1 : 0);
  }

  if (nbNewScreenshot > 0) {
    console.log(`\n❇️  ${nbNewScreenshot} nouveau(x) screenshot(s) enregistré(s).`);
    process.exit(0);
  }

  console.log("🎉 All visual tests passed!");
  process.exit(0);
};

const isRunAsMain =
  import.meta.main === true ||
  (typeof process.argv[1] === "string" && process.argv[1].includes("compare-visual-regressions"));

if (isRunAsMain) {
  compareVisualRegressions().catch(err => {
    console.error("\n❌ Erreur comparaison:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { compareVisualRegressions };
