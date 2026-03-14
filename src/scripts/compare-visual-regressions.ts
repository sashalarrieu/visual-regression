// scripts/compare-visual-regressions.ts (package @setshao/visual-regression)
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";

import pixelmatch from "pixelmatch";
import { Browser, chromium } from "playwright";
import { PNG } from "pngjs";
import { buildIndex } from "storybook/internal/core-server";
import type { StoryIndexEntry } from "storybook/internal/types";

import type { DeviceConfig, LogsType } from "../types/types";
import {
  DIFF_SCREENSHOT_NAME,
  FORCE_VR_TAG,
  IGNORE_VR_TAG,
  MAX_TEST_TIME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOT_NAME,
  SCREENSHOTS_DIR,
  STORY_BASE_URI,
  TEMP_SCREENSHOT_NAME,
  THRESHOLD,
} from "../constants/constants";
import { getDevicesConfig, getProjectPaths, getProjectRoot, loadVrDevicesConfig } from "../utils/node";

const PROJECT_ROOT = getProjectRoot();
const { publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR, storybookConfigDir: STORYBOOK_CONFIG_DIR } =
  getProjectPaths(PROJECT_ROOT);
const DEVICES = getDevicesConfig(loadVrDevicesConfig(PROJECT_ROOT));

/** Options de lancement Chromium : timeout augmenté et args Windows. */
const CHROMIUM_LAUNCH_OPTIONS = {
  timeout: 300_000,
  headless: true,
  ...(process.platform === "win32" && {
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  }),
};

/** Options communes pour Chrome/Edge sur Windows (lancement parfois lent : AV, premier démarrage). */
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

/**
 * Lance un navigateur pour les captures. Sur Windows, on évite chromium_headless_shell (timeouts)
 * en utilisant Chrome ou Edge système avec timeout long, sinon Chromium bundlé.
 */
async function launchBrowser(): Promise<Browser> {
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
  return await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
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
  console.error(log);
  logs.errors.push(log);
};

/**
 * Supprime tous les fichiers de régressions visuelles
 */
const deleteAllVisualRegressionsFiles = () => {
  if (existsSync(PUBLIC_SCREENSHOTS_DIR)) {
    rmSync(PUBLIC_SCREENSHOTS_DIR, { recursive: true, force: true });
  }
};

/**
 * Supprime les images correspondantes à une story et device avant régénération
 * Inclut les fichiers dans le dossier deleted/ également
 */
const deleteStoryScreenshotsForRegeneration = (componentDir: string, deviceName: string, storyId: string) => {
  const pathsToDelete = [
    // Fichier temp
    path.join(
      PUBLIC_SCREENSHOTS_DIR,
      componentDir,
      `${TEMP_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
    ),
    // Fichier diff
    path.join(
      PUBLIC_SCREENSHOTS_DIR,
      componentDir,
      `${DIFF_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
    ),
    // Fichier new
    path.join(PUBLIC_SCREENSHOTS_DIR, componentDir, `${NEW_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`),
    // Fichier original dans public
    path.join(PUBLIC_SCREENSHOTS_DIR, componentDir, `${deviceName}-${storyId}${SCREENSHOT_NAME}`),
    // Fichiers dans deleted/ : diff, new, temp et original
    path.join(
      PUBLIC_SCREENSHOTS_DIR,
      "deleted",
      componentDir,
      `${DIFF_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
    ),
    path.join(
      PUBLIC_SCREENSHOTS_DIR,
      "deleted",
      componentDir,
      `${NEW_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
    ),
    path.join(
      PUBLIC_SCREENSHOTS_DIR,
      "deleted",
      componentDir,
      `${TEMP_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
    ),
    path.join(PUBLIC_SCREENSHOTS_DIR, "deleted", componentDir, `${deviceName}-${storyId}${SCREENSHOT_NAME}`),
  ];

  for (const filePath of pathsToDelete) {
    if (existsSync(filePath)) {
      try {
        rmSync(filePath, { force: true });
      } catch (err) {
        console.warn(`⚠️  Erreur lors de la suppression de ${filePath}:`, err);
      }
    }
  }
};

const shouldIncludeStoryForVisualRegression = (entry: StoryIndexEntry): boolean => {
  const tags = entry.tags ?? [];

  const isStoryForced = tags.includes(FORCE_VR_TAG);
  const isStoryIgnored = tags.includes(IGNORE_VR_TAG);

  return isStoryForced || !isStoryIgnored;
};

// 1. Trouver tous les dossiers contenant un fichier .stories.tsx
// buildIndex résout les stories (glob dans main.ts) par rapport à process.cwd() dans certaines versions.
// On s'assure donc d'être dans la racine du projet pour que ../src/**/*.stories soit correct.
const getAllStories = async (): Promise<StoryIndexEntry[]> => {
  // #region agent log
  fetch("http://127.0.0.1:7703/ingest/b2510414-2bb2-4076-a83e-05c741ec7b98", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bd8ea2" },
    body: JSON.stringify({
      sessionId: "bd8ea2",
      location: "compare-visual-regressions.ts:getAllStories entry",
      message: "getAllStories called",
      data: { PROJECT_ROOT, STORYBOOK_CONFIG_DIR, cwd: process.cwd() },
      timestamp: Date.now(),
      hypothesisId: "A",
    }),
  }).catch(() => {});
  // #endregion
  const previousCwd = process.cwd();
  try {
    process.chdir(PROJECT_ROOT);
    const index = await buildIndex({
      configDir: STORYBOOK_CONFIG_DIR,
    });
    const entriesCount = Object.keys(index.entries).length;
    const filtered = Object.values(index.entries).filter((entry): entry is StoryIndexEntry => {
      return entry.type === "story" && shouldIncludeStoryForVisualRegression(entry);
    });
    // #region agent log
    fetch("http://127.0.0.1:7703/ingest/b2510414-2bb2-4076-a83e-05c741ec7b98", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bd8ea2" },
      body: JSON.stringify({
        sessionId: "bd8ea2",
        location: "compare-visual-regressions.ts:getAllStories after buildIndex",
        message: "getAllStories result",
        data: { entriesCount, storiesCount: filtered.length, sampleIds: filtered.slice(0, 3).map(s => s.id) },
        timestamp: Date.now(),
        hypothesisId: "A",
      }),
    }).catch(() => {});
    // #endregion
    return filtered;
  } finally {
    process.chdir(previousCwd);
  }
};

const captureScreenshotWithPlaywright = async ({
  browser,
  storyId,
  tempScreenshotPath,
  logs,
  deviceName,
  deviceConfig,
}: {
  browser: Browser;
  storyId: string;
  tempScreenshotPath: string;
  logs: LogsType;
  deviceName: string;
  deviceConfig: DeviceConfig;
}) => {
  const context = await browser.newContext({
    viewport: { width: deviceConfig.width, height: deviceConfig.height },
    deviceScaleFactor: deviceConfig.deviceScaleFactor,
    isMobile: deviceConfig.mobile ?? false,
  });
  const page = await context.newPage();

  // Démarrage du timer
  const timer = setTimeout(() => {
    addLogs({ log: `⌛️ Waiting time expired for capture ${storyId} (${deviceName}) (${MAX_TEST_TIME}ms)`, logs });
  }, MAX_TEST_TIME);

  try {
    await page.goto(`${STORY_BASE_URI}${storyId}`, { waitUntil: "networkidle" });

    // Créer dossier si besoin
    mkdirSync(path.dirname(tempScreenshotPath), { recursive: true });

    // Screenshot uniquement du composant
    await page.screenshot({
      path: tempScreenshotPath,
    });
  } catch {
    addLogs({ log: `📸 Failed to capture screenshot for ${storyId} (${deviceName})`, logs });
  } finally {
    clearTimeout(timer); // Si tout s'est bien passé, on annule le timeout
    await page?.close();
    await context?.close();
  }
};

const compareScreenshots = ({
  storyId,
  screenshotPath,
  publicScreenshotPath,
  newScreenshotPath,
  tempScreenshotPath,
  diffScreenshotPath,
  storiesWithDiff,
  logs,
}: {
  storyId: string;
  screenshotPath: string;
  publicScreenshotPath: string;
  newScreenshotPath: string;
  tempScreenshotPath: string;
  diffScreenshotPath: string;
  storiesWithDiff: string[];
  logs: LogsType;
}) => {
  if (!existsSync(tempScreenshotPath)) {
    addLogs({ log: `🚫 No temp screenshot found for ${tempScreenshotPath}`, logs });
    return;
  }

  if (!existsSync(screenshotPath)) {
    renameSync(tempScreenshotPath, newScreenshotPath);
    addLogs({ log: `❇️  New screenshot for ${screenshotPath}`, type: "new", logs });
    return;
  }

  const img1 = PNG.sync.read(readFileSync(screenshotPath));
  const img2 = PNG.sync.read(readFileSync(tempScreenshotPath));

  // Calculer les dimensions max
  const width = Math.max(img1.width, img2.width);
  const height = Math.max(img1.height, img2.height);

  // Créer un diff avec la taille max
  const diff = new PNG({ width, height });

  // Copier img1 et img2 dans des buffers temporaires à la taille max
  const tmp1 = new PNG({ width, height });
  PNG.bitblt(img1, tmp1, 0, 0, img1.width, img1.height, 0, 0);
  const tmp2 = new PNG({ width, height });
  PNG.bitblt(img2, tmp2, 0, 0, img2.width, img2.height, 0, 0);

  const numDiffPixels = pixelmatch(tmp1.data, tmp2.data, diff.data, width, height, {
    threshold: THRESHOLD,
  });

  if (numDiffPixels > 0 || img1.width !== img2.width || img1.height !== img2.height) {
    mkdirSync(path.dirname(diffScreenshotPath), { recursive: true });
    writeFileSync(diffScreenshotPath, PNG.sync.write(diff));

    // Copier l'original dans les screenshots public
    copyFileSync(screenshotPath, publicScreenshotPath);

    if (!storiesWithDiff.includes(diffScreenshotPath)) {
      storiesWithDiff.push(diffScreenshotPath);
    }
    addLogs({ log: `⚠️  Visual regression for ${storyId} (${numDiffPixels} pixels)`, type: "vr", logs });
    return;
  }

  console.log(`✅ No visual regression for ${storyId}`);
};

/**
 * Régénère une sélection de stories (storyId + deviceName).
 * Même flux que compareByType / compareAllStories : log de la sélection, suppression des anciennes,
 * capture des nouvelles, comparaison. Utilisé par "Régénérer la sélection", les boutons restore
 * (DeletedItemRow, TreePanel) et compareSingleStory.
 */
export const compareSelectedStories = async (
  storiesToCompare: { storyId: string; deviceName: string }[],
): Promise<{ success: boolean; error?: string }> => {
  const logs: LogsType = {
    errors: [],
    vrs: [],
    news: [],
  };
  const storiesWithDiff: string[] = [];

  const browser = await launchBrowser();

  try {
    const stories = await getAllStories();

    type FileToRegenerate = { componentDir: string };
    const filesToRegenerate = new Map<string, Map<string, FileToRegenerate>>();

    for (const { storyId, deviceName: d } of storiesToCompare) {
      if (!DEVICES[d]) {
        addLogs({ log: `⚠️  Device ${d} not found, skipping ${storyId}`, logs });
        continue;
      }
      const story = stories.find(s => s.id === storyId);
      if (!story) {
        addLogs({ log: `⚠️  Story ${storyId} not found, skipping`, logs });
        continue;
      }
      const componentDir = path.dirname(story.importPath);
      if (!filesToRegenerate.has(d)) {
        filesToRegenerate.set(d, new Map());
      }
      filesToRegenerate.get(d)!.set(storyId, { componentDir });
    }

    let totalFilesCount = 0;
    for (const deviceMap of filesToRegenerate.values()) {
      totalFilesCount += deviceMap.size;
    }

    console.log(`\n🔍 Sélection | Fichiers: ${totalFilesCount} | Devices: ${filesToRegenerate.size}`);

    for (const [currentDevice, deviceMap] of filesToRegenerate.entries()) {
      console.log(`\n  📱 Device: ${currentDevice} (${deviceMap.size} fichier${deviceMap.size > 1 ? "s" : ""})`);
      let index = 1;
      for (const [storyId, { componentDir }] of deviceMap.entries()) {
        console.log(`    ${index}. ${storyId} | ${componentDir}`);
        index++;
      }
    }

    for (const [currentDevice, deviceMap] of filesToRegenerate.entries()) {
      const deviceConfig = DEVICES[currentDevice];
      if (!deviceConfig) {
        addLogs({ log: `⚠️  Device ${currentDevice} not found, skipping`, logs });
        continue;
      }

      for (const [storyId, { componentDir }] of deviceMap.entries()) {
        const screenshotDir = path.join(componentDir, SCREENSHOTS_DIR);
        const screenshotPath = path.join(screenshotDir, `${currentDevice}-${storyId}${SCREENSHOT_NAME}`);
        const publicScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const newScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${NEW_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const tempScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${TEMP_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const diffScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${DIFF_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );

        deleteStoryScreenshotsForRegeneration(componentDir, currentDevice, storyId);

        await captureScreenshotWithPlaywright({
          browser,
          storyId,
          tempScreenshotPath,
          logs,
          deviceName: currentDevice,
          deviceConfig,
        });
        await compareScreenshots({
          storyId: `${currentDevice}-${storyId}`,
          screenshotPath,
          publicScreenshotPath,
          newScreenshotPath,
          tempScreenshotPath,
          diffScreenshotPath,
          storiesWithDiff,
          logs,
        });
      }
    }

    if (totalFilesCount === 0) {
      console.log(`\n🚫 Aucun fichier à régénérer pour la sélection`);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await browser.close();
  }
};

/**
 * Compare une story spécifique pour un device donné.
 * Délègue à compareSelectedStories pour uniformiser le flux (log, suppression, capture, comparaison).
 */
export const compareSingleStory = async (
  storyId: string,
  deviceName: string,
): Promise<{ success: boolean; error?: string }> => compareSelectedStories([{ storyId, deviceName }]);

/**
 * Extrait le device et le storyId depuis un nom de fichier dans deleted/
 * Format attendu: __new__{deviceName}-{storyId}.screenshot.png ou __diff__{deviceName}-{storyId}.screenshot.png
 */
const extractDeviceAndStoryIdFromDeletedFile = (
  fileName: string,
  allDevices: string[],
): { deviceName: string | null; storyId: string | null; prefix: string | null } => {
  // Retirer l'extension
  const fileNameWithoutExt = fileName.replace(SCREENSHOT_EXTENSION, "");

  // Identifier le préfixe (__new__ ou __diff__)
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

  // Retirer .screenshot du nom
  fileNameWithoutPrefix = fileNameWithoutPrefix.replace(SCREENSHOT_NAME.replace(SCREENSHOT_EXTENSION, ""), "");

  // Le format restant est: deviceName-storyId
  // Chercher le device qui correspond au début du nom
  for (const device of allDevices) {
    if (fileNameWithoutPrefix.startsWith(`${device}-`)) {
      const storyId = fileNameWithoutPrefix.substring(device.length + 1);
      return { deviceName: device, storyId, prefix };
    }
  }

  return { deviceName: null, storyId: null, prefix };
};

/**
 * Régénère toutes les stories pour un device donné (ou tous les devices si non spécifié)
 * Cette fonction régénère toutes les stories sans condition, contrairement à compareByType
 * qui ne régénère que celles qui sont dans le dossier deleted/
 */
export const compareAllStories = async (deviceName?: string): Promise<{ success: boolean; error?: string }> => {
  // #region agent log
  fetch("http://127.0.0.1:7703/ingest/b2510414-2bb2-4076-a83e-05c741ec7b98", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bd8ea2" },
    body: JSON.stringify({
      sessionId: "bd8ea2",
      location: "compare-visual-regressions.ts:compareAllStories entry",
      message: "compareAllStories called",
      data: { deviceName, DEVICESCount: Object.keys(DEVICES).length },
      timestamp: Date.now(),
      hypothesisId: "C_D",
    }),
  }).catch(() => {});
  // #endregion
  const logs: LogsType = {
    errors: [],
    vrs: [],
    news: [],
  };
  const storiesWithDiff: string[] = [];

  const browser = await launchBrowser();

  try {
    const stories = await getAllStories();
    const allDevices = Object.keys(DEVICES);
    // #region agent log
    fetch("http://127.0.0.1:7703/ingest/b2510414-2bb2-4076-a83e-05c741ec7b98", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bd8ea2" },
      body: JSON.stringify({
        sessionId: "bd8ea2",
        location: "compare-visual-regressions.ts:compareAllStories after getAllStories",
        message: "stories and devices",
        data: { storiesCount: stories.length, allDevicesCount: allDevices.length, allDevices },
        timestamp: Date.now(),
        hypothesisId: "A_D",
      }),
    }).catch(() => {});
    // #endregion

    // Structure pour stocker les fichiers à régénérer: Map<deviceName, Map<storyId, { componentDir }>>
    type FileToRegenerate = {
      componentDir: string;
    };
    const filesToRegenerate = new Map<string, Map<string, FileToRegenerate>>();

    // Si un device est spécifié, ne traiter que ce device
    // Sinon, traiter tous les devices
    const devicesToProcess = deviceName ? [deviceName] : allDevices;

    // Pour chaque device à traiter, récupérer toutes les stories
    for (const currentDevice of devicesToProcess) {
      if (!DEVICES[currentDevice]) {
        addLogs({ log: `⚠️  Device ${currentDevice} not found, skipping`, logs });
        continue;
      }

      // Créer une map pour ce device
      if (!filesToRegenerate.has(currentDevice)) {
        filesToRegenerate.set(currentDevice, new Map());
      }
      const deviceMap = filesToRegenerate.get(currentDevice)!;

      // Ajouter toutes les stories pour ce device
      for (const story of stories) {
        const componentDir = path.dirname(story.importPath);
        deviceMap.set(story.id, { componentDir });
      }
    }

    // Compter le total de fichiers trouvés
    let totalFilesCount = 0;
    for (const deviceMap of filesToRegenerate.values()) {
      totalFilesCount += deviceMap.size;
    }

    // Log des fichiers trouvés
    console.log(
      `\n🔍 Régénération complète | Device: ${deviceName || "all"} | Fichiers: ${totalFilesCount} | Devices: ${filesToRegenerate.size}`,
    );

    // Afficher les détails
    for (const [currentDevice, deviceMap] of filesToRegenerate.entries()) {
      console.log(`\n  📱 Device: ${currentDevice} (${deviceMap.size} fichier${deviceMap.size > 1 ? "s" : ""})`);
      let index = 1;
      for (const [storyId, { componentDir }] of deviceMap.entries()) {
        console.log(`    ${index}. ${storyId} | ${componentDir}`);
        index++;
      }
    }

    // Régénérer chaque fichier trouvé
    for (const [currentDevice, deviceMap] of filesToRegenerate.entries()) {
      const deviceConfig = DEVICES[currentDevice];
      if (!deviceConfig) {
        addLogs({ log: `⚠️  Device ${currentDevice} not found, skipping`, logs });
        continue;
      }

      for (const [storyId, { componentDir }] of deviceMap.entries()) {
        const screenshotDir = path.join(componentDir, SCREENSHOTS_DIR);
        const screenshotPath = path.join(screenshotDir, `${currentDevice}-${storyId}${SCREENSHOT_NAME}`);
        const publicScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const newScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${NEW_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const tempScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${TEMP_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const diffScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${DIFF_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );

        // Supprimer les images correspondantes avant régénération
        deleteStoryScreenshotsForRegeneration(componentDir, currentDevice, storyId);

        await captureScreenshotWithPlaywright({
          browser,
          storyId,
          tempScreenshotPath,
          logs,
          deviceName: currentDevice,
          deviceConfig,
        });
        await compareScreenshots({
          storyId: `${currentDevice}-${storyId}`,
          screenshotPath,
          publicScreenshotPath,
          newScreenshotPath,
          tempScreenshotPath,
          diffScreenshotPath,
          storiesWithDiff,
          logs,
        });
      }
    }

    if (totalFilesCount === 0) {
      console.log(`\n🚫 Aucun fichier à régénérer${deviceName ? ` pour le device "${deviceName}"` : ""}`);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Fermer proprement
    await browser.close();
  }
};

/**
 * Compare les stories selon un type (new, diff, rejected) et optionnellement un device
 */
export const compareByType = async (
  type: "new" | "diff" | "rejected",
  deviceName?: string,
): Promise<{ success: boolean; error?: string }> => {
  const logs: LogsType = {
    errors: [],
    vrs: [],
    news: [],
  };
  const storiesWithDiff: string[] = [];

  const browser = await launchBrowser();

  try {
    const stories = await getAllStories();
    const allDevices = Object.keys(DEVICES);

    // Structure pour stocker les fichiers à régénérer: Map<deviceName, Map<storyId, { componentDir, prefix }>>
    type FileToRegenerate = {
      componentDir: string;
      prefix: string;
    };
    const filesToRegenerate = new Map<string, Map<string, FileToRegenerate>>();

    // Scanner le dossier deleted/ pour trouver les fichiers correspondant au type et device
    const deletedDir = path.join(PUBLIC_SCREENSHOTS_DIR, "deleted");

    if (!existsSync(deletedDir)) {
      console.log(
        `\n🔍 Type: "${type}" | Device: ${deviceName || "all"} | Aucun fichier trouvé (dossier deleted/ n'existe pas)`,
      );
      return { success: true };
    }

    // Parcourir récursivement le dossier deleted/ pour trouver les fichiers
    const scanDeletedDir = (dir: string, relativePath: string = "") => {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = statSync(fullPath);
          const currentRelativePath = relativePath ? `${relativePath}/${file}` : file;

          if (stat.isDirectory()) {
            scanDeletedDir(fullPath, currentRelativePath);
          } else if (file.endsWith(SCREENSHOT_EXTENSION)) {
            // Extraire le device, storyId et le préfixe depuis le nom de fichier
            const {
              deviceName: foundDevice,
              storyId,
              prefix,
            } = extractDeviceAndStoryIdFromDeletedFile(file, allDevices);

            if (!foundDevice || !storyId || !prefix) {
              continue;
            }

            // Filtrer selon le type demandé
            const isNewFile = prefix === NEW_SCREENSHOT_NAME;
            const isDiffFile = prefix === DIFF_SCREENSHOT_NAME;

            let shouldInclude = false;
            if (type === "new" && isNewFile) {
              shouldInclude = true;
            } else if (type === "diff" && isDiffFile) {
              shouldInclude = true;
            } else if (type === "rejected" && (isNewFile || isDiffFile)) {
              shouldInclude = true;
            }

            if (!shouldInclude) {
              continue;
            }

            // Filtrer selon le device si spécifié
            if (deviceName && foundDevice !== deviceName) {
              continue;
            }

            // Trouver la story correspondante pour obtenir le componentDir
            const story = stories.find(s => s.id === storyId);
            if (!story) {
              continue;
            }

            const componentDir = path.dirname(story.importPath);

            // Ajouter à la liste des fichiers à régénérer
            if (!filesToRegenerate.has(foundDevice)) {
              filesToRegenerate.set(foundDevice, new Map());
            }
            const deviceMap = filesToRegenerate.get(foundDevice)!;
            deviceMap.set(storyId, { componentDir, prefix });
          }
        }
      } catch (err) {
        console.log(
          `🚫 Erreur lors de la lecture du dossier deleted : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    scanDeletedDir(deletedDir);

    // Compter le total de fichiers trouvés
    let totalFilesCount = 0;
    for (const deviceMap of filesToRegenerate.values()) {
      totalFilesCount += deviceMap.size;
    }

    // Log des fichiers trouvés
    console.log(
      `\n🔍 Type: "${type}" | Device: ${deviceName || "all"} | Fichiers: ${totalFilesCount} | Devices: ${filesToRegenerate.size}`,
    );

    // Afficher les détails
    for (const [currentDevice, deviceMap] of filesToRegenerate.entries()) {
      console.log(`\n  📱 Device: ${currentDevice} (${deviceMap.size} fichier${deviceMap.size > 1 ? "s" : ""})`);
      let index = 1;
      for (const [storyId, { componentDir }] of deviceMap.entries()) {
        console.log(`    ${index}. ${storyId} | ${componentDir}`);
        index++;
      }
    }

    // Régénérer chaque fichier trouvé
    for (const [currentDevice, deviceMap] of filesToRegenerate.entries()) {
      const deviceConfig = DEVICES[currentDevice];
      if (!deviceConfig) {
        addLogs({ log: `⚠️  Device ${currentDevice} not found, skipping`, logs });
        continue;
      }

      for (const [storyId, { componentDir }] of deviceMap.entries()) {
        const screenshotDir = path.join(componentDir, SCREENSHOTS_DIR);
        const screenshotPath = path.join(screenshotDir, `${currentDevice}-${storyId}${SCREENSHOT_NAME}`);
        const publicScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const newScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${NEW_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const tempScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${TEMP_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );
        const diffScreenshotPath = path.join(
          PUBLIC_SCREENSHOTS_DIR,
          componentDir,
          `${DIFF_SCREENSHOT_NAME}${currentDevice}-${storyId}${SCREENSHOT_NAME}`,
        );

        // Supprimer les images correspondantes avant régénération
        deleteStoryScreenshotsForRegeneration(componentDir, currentDevice, storyId);

        await captureScreenshotWithPlaywright({
          browser,
          storyId,
          tempScreenshotPath,
          logs,
          deviceName: currentDevice,
          deviceConfig,
        });
        await compareScreenshots({
          storyId: `${currentDevice}-${storyId}`,
          screenshotPath,
          publicScreenshotPath,
          newScreenshotPath,
          tempScreenshotPath,
          diffScreenshotPath,
          storiesWithDiff,
          logs,
        });
      }
    }

    if (totalFilesCount === 0) {
      console.log(
        `\n🚫 Aucun fichier à régénérer pour le type "${type}"${deviceName ? ` sur le device "${deviceName}"` : ""}`,
      );
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Fermer proprement
    await browser.close();
  }
};

const compareVisualRegressions = async () => {
  // #region agent log
  fetch("http://127.0.0.1:7703/ingest/b2510414-2bb2-4076-a83e-05c741ec7b98", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bd8ea2" },
    body: JSON.stringify({
      sessionId: "bd8ea2",
      location: "compare-visual-regressions.ts:compareVisualRegressions entry",
      message: "compareVisualRegressions (script main) called",
      data: {},
      timestamp: Date.now(),
      hypothesisId: "E",
    }),
  }).catch(() => {});
  // #endregion
  const logs: LogsType = {
    errors: [],
    vrs: [],
    news: [],
  };
  const storiesWithDiff: string[] = [];

  const browser = await launchBrowser();

  try {
    const stories = await getAllStories();
    // #region agent log
    fetch("http://127.0.0.1:7703/ingest/b2510414-2bb2-4076-a83e-05c741ec7b98", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "bd8ea2" },
      body: JSON.stringify({
        sessionId: "bd8ea2",
        location: "compare-visual-regressions.ts:compareVisualRegressions after getAllStories",
        message: "script main getAllStories result",
        data: { storiesCount: stories.length },
        timestamp: Date.now(),
        hypothesisId: "A_E",
      }),
    }).catch(() => {});
    // #endregion
    if (stories.length === 0) {
      addLogs({ log: `🚫 No stories found`, logs });
    } else {
      const totalScreenshots = stories.length * Object.keys(DEVICES).length;
      console.log(
        `🐍 ${stories.length} stories × ${Object.keys(DEVICES).length} devices = ${totalScreenshots} screenshots will be generated. Please wait.`,
      );

      deleteAllVisualRegressionsFiles();

      for (const story of stories) {
        const { importPath: storyPath, id: storyId } = story;

        // Itérer sur chaque device configuré
        for (const [deviceName, deviceConfig] of Object.entries(DEVICES)) {
          try {
            const componentDir = path.dirname(storyPath); // ./src/atoms/Alert
            const screenshotDir = path.join(componentDir, SCREENSHOTS_DIR); // src/atoms/Alert/screenshots/
            // Inclure le nom du device dans le chemin
            const screenshotPath = path.join(screenshotDir, `${deviceName}-${storyId}${SCREENSHOT_NAME}`); // src/atoms/Alert/screenshots/desktop-fhd-atoms-alert--primary.screenshot.png
            const publicScreenshotPath = path.join(
              PUBLIC_SCREENSHOTS_DIR,
              componentDir,
              `${deviceName}-${storyId}${SCREENSHOT_NAME}`,
            ); // public/screenshots/src/atoms/Alert/desktop-fhd-atoms-alert--primary.screenshot.png
            const newScreenshotPath = path.join(
              PUBLIC_SCREENSHOTS_DIR,
              componentDir,
              `${NEW_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
            ); // public/screenshots/src/atoms/Alert/__new__desktop-fhd-atoms-alert--primary.screenshot.png
            const tempScreenshotPath = path.join(
              PUBLIC_SCREENSHOTS_DIR,
              componentDir,
              `${TEMP_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
            ); // public/screenshots/src/atoms/Alert/__temp__desktop-fhd-atoms-alert--primary.screenshot.png
            const diffScreenshotPath = path.join(
              PUBLIC_SCREENSHOTS_DIR,
              componentDir,
              `${DIFF_SCREENSHOT_NAME}${deviceName}-${storyId}${SCREENSHOT_NAME}`,
            ); // public/screenshots/src/atoms/Alert/__diff__desktop-fhd-atoms-alert--primary.screenshot.png

            await captureScreenshotWithPlaywright({
              browser,
              storyId,
              tempScreenshotPath,
              logs,
              deviceName,
              deviceConfig,
            });
            await compareScreenshots({
              storyId: `${deviceName}-${storyId}`,
              screenshotPath,
              publicScreenshotPath,
              newScreenshotPath,
              tempScreenshotPath,
              diffScreenshotPath,
              storiesWithDiff,
              logs,
            });
          } catch {
            addLogs({ log: `🚫 Error testing ${storyId} (${deviceName})`, logs });
          }
        }
      }
    }
  } finally {
    // Fermer proprement
    await browser.close();
  }

  if (logs.errors.length > 0 || logs.vrs.length > 0 || logs.news.length > 0) {
    const nbErrors = logs.errors.length;
    if (nbErrors) {
      console.log(`\n\n   ============================`);
      console.log(`🚫  Errors`);
      console.log(`   ========= ERRORS ===========`);
      logs.errors.map(log => console.error(`${log}`));
    }

    const nbVisualRegressions = logs.vrs.length;
    if (nbVisualRegressions) {
      console.error(`\n\n   ============================`);
      console.error(`⚠️  Visual tests failed : ${nbVisualRegressions}`);
      console.error(`   ============ VR ============`);
      logs.vrs.map(log => console.error(`${log}`));
    }

    const nbNewScreenshot = logs.news.length;
    if (nbNewScreenshot) {
      console.log(`\n\n   ============================`);
      console.log(`❇️  New screenshots : ${nbNewScreenshot}`);
      console.log(`   ========== NEW =============`);
      logs.news.map(log => console.log(`${log}`));
    }

    console.error(`\n\n⚠️  Visual tests failed : ${nbVisualRegressions}`);
    console.log(`❇️  New screenshots : ${nbNewScreenshot}`);

    process.exit(0);
  } else {
    console.log("🎉 All visual tests passed!");
    process.exit(0);
  }
};

// Ne lancer la comparaison complète que si le script est exécuté directement
// (pas quand il est importé comme module)
if (import.meta.main) {
  compareVisualRegressions();
}
