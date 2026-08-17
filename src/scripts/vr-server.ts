// scripts/vr-server.ts (package @setshao/visual-regression)
import { spawn } from "child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  watch,
} from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { createServer } from "http";
import path from "path";
import { pathToFileURL } from "url";

import {
  DIFF_SCREENSHOT_NAME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
  VALIDATED_DIR_NAME,
  VR_SERVER_PORT,
  VR_SERVER_URL,
} from "../constants/constants";
import type { RegressionIndex, StoryDevicePair, StoryScreenshotsPath } from "../types/types";
import {
  countEligibleStorybookStories,
  getDevicesDisplayConfig,
  getNodeTsxArgs,
  getProjectPaths,
  getProjectRoot,
  getScriptDir,
  getStorybookUrl,
  getVrPublicConfig,
  resolveVrConfig,
  spawnShellOption,
} from "../utils/node";
import { purgeIgnoredCaptureErrors } from "../utils/vr-capture-errors";
import { warmStorybookIndexCache } from "../utils/vr-storybook-index";

import {
  buildIndexFromScan,
  calculateImagePaths,
  countRedPixelsInDiffImage,
  formatScreenshotLogLabel,
  getDiffScreenshotVariants,
  pickScreenshotPathForLog,
} from "./vr-server-index";
import { buildOrphansTree } from "./vr-server-orphans-tree";
import { buildStoriesTree } from "./vr-server-stories-tree";

const PROJECT_ROOT = getProjectRoot();
const {
  publicDir: PUBLIC_DIR,
  publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR,
  deletedDir: DELETED_DIR,
  validatedDir: VALIDATED_DIR,
} = getProjectPaths(PROJECT_ROOT);
const SCRIPT_DIR = getScriptDir(import.meta);
const join = path.join;
const dirname = path.dirname;
const resolvePath = path.resolve;

const importCompareModule = () => import(pathToFileURL(join(SCRIPT_DIR, "compare-visual-regressions.ts")).href);

type CompareRunResult = { success: boolean; error?: string };

/** Lance une compare en arrière-plan — la route HTTP répond tout de suite (comme POST /compare). */
const runCompareAsync = (
  label: string,
  run: () => Promise<CompareRunResult>,
  options?: { allowEmptyRefresh?: boolean },
): void => {
  void (async () => {
    try {
      const result = await run();
      if (result.success) {
        refreshIndex({ notify: true, allowEmpty: options?.allowEmptyRefresh ?? false });
        console.log(`✅ ${label}`);
      } else {
        console.error(`❌ ${label}:`, result.error ?? "erreur inconnue");
      }
    } catch (err) {
      console.error(`❌ ${label}:`, err);
    }
  })();
};

// ============================================
// INDEX DES RÉGRESSIONS (en mémoire)
// ============================================

let index: RegressionIndex = {
  diffPaths: [],
  newPaths: [],
  deletedPaths: [],
  validatedPaths: [],
  tree: null,
  deletedItems: [],
  validatedItems: [],
  lastUpdate: 0,
};
const metricsCache = new Map<string, number | null>();

type RefreshIndexOptions = {
  notify?: boolean;
  /** Si false, ignore un scan vide quand l'index contenait déjà des régressions (ex. compare qui vide public/Screenshots/). */
  allowEmpty?: boolean;
};

const refreshIndex = (options: RefreshIndexOptions | boolean = {}): void => {
  const { notify = true, allowEmpty = true } = typeof options === "boolean" ? { notify: options } : options;
  const previousCount = index.diffPaths.length + index.newPaths.length;
  const next = buildIndexFromScan();
  const nextCount = next.diffPaths.length + next.newPaths.length;

  if (!allowEmpty && nextCount === 0 && previousCount > 0) {
    console.log("♻️  Scan vide ignoré (index précédent conservé)");
    return;
  }

  index = next;
  metricsCache.clear();

  if (notify && sseClients.size > 0) {
    notifyAllClients();
  }
};

const resolveMetricsAbsPath = (imagePath: string): string | null => {
  const normalized = imagePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("Screenshots/")) {
    return null;
  }
  const absPath = join(PUBLIC_DIR, ...normalized.split("/"));
  return existsSync(absPath) ? absPath : null;
};

const getPixelDiffMetrics = (imagePath: string): number | null => {
  if (metricsCache.has(imagePath)) {
    return metricsCache.get(imagePath) ?? null;
  }
  const absPath = resolveMetricsAbsPath(imagePath);
  const count = absPath ? countRedPixelsInDiffImage(absPath) : null;
  metricsCache.set(imagePath, count);
  return count;
};

// ============================================
// HELPERS HTTP
// ============================================

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
};

const sendJson = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(data));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

// ============================================
// SYSTÈME DE NOTIFICATIONS SSE (Node)
// ============================================

type NodeSSEClient = { id: string; res: ServerResponse };
const sseClients = new Set<NodeSSEClient>();

const notifyAllClients = () => {
  const message = JSON.stringify({ type: "index-updated", timestamp: Date.now() });
  const toRemove: NodeSSEClient[] = [];

  for (const client of sseClients) {
    try {
      client.res.write(`data: ${message}\n\n`);
    } catch (err) {
      console.warn("⚠️  Error sending SSE to client, removing:", err);
      toRemove.push(client);
    }
  }

  toRemove.forEach(client => sseClients.delete(client));
};

// ============================================
// SURVEILLANCE DU DOSSIER SCREENSHOTS
// ============================================

let watchDebounceTimer: NodeJS.Timeout | null = null;
let watchRestartTimer: NodeJS.Timeout | null = null;
let activeWatcher: ReturnType<typeof watch> | null = null;

const isRegressionScreenshot = (relativePath: string): boolean =>
  relativePath.endsWith(SCREENSHOT_EXTENSION) &&
  (relativePath.includes(DIFF_SCREENSHOT_NAME) || relativePath.includes(NEW_SCREENSHOT_NAME));

const scheduleWatcherRestart = () => {
  if (watchRestartTimer) clearTimeout(watchRestartTimer);
  watchRestartTimer = setTimeout(() => {
    watchRestartTimer = null;
    watchScreenshotsDirectory();
  }, 1500);
};

const watchScreenshotsDirectory = () => {
  if (!existsSync(PUBLIC_SCREENSHOTS_DIR)) {
    mkdirSync(PUBLIC_SCREENSHOTS_DIR, { recursive: true });
  }
  if (!existsSync(DELETED_DIR)) {
    mkdirSync(DELETED_DIR, { recursive: true });
  }

  if (activeWatcher) {
    try {
      activeWatcher.close();
    } catch {
      // ignore
    }
    activeWatcher = null;
  }

  const debouncedRefresh = () => {
    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
    }
    watchDebounceTimer = setTimeout(() => {
      refreshIndex({ notify: true, allowEmpty: false });
      watchDebounceTimer = null;
    }, 1000);
  };

  try {
    const watcher = watch(PUBLIC_SCREENSHOTS_DIR, { recursive: true }, (_, filename) => {
      if (!filename) return;

      if (!existsSync(PUBLIC_SCREENSHOTS_DIR)) {
        scheduleWatcherRestart();
        return;
      }

      const fullPath = filename.startsWith(PUBLIC_SCREENSHOTS_DIR) ? filename : join(PUBLIC_SCREENSHOTS_DIR, filename);
      const relativePath = fullPath.replace(PUBLIC_DIR, "").replace(/\\/g, "/");

      if (isRegressionScreenshot(relativePath)) {
        debouncedRefresh();
      }
    });

    activeWatcher = watcher;

    watcher.on("error", error => {
      const isEperm = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EPERM" || String(e).includes("EPERM");
      try {
        watcher.close();
      } catch {
        // ignore
      }
      activeWatcher = null;
      if (!isEperm(error)) {
        console.warn("⚠️  Erreur lors de la surveillance du dossier Screenshots:", error);
      }
      scheduleWatcherRestart();
    });

    return watcher;
  } catch (error) {
    const isEperm = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EPERM" || String(e).includes("EPERM");
    if (!isEperm(error)) {
      console.warn(`⚠️  Impossible de surveiller ${PUBLIC_SCREENSHOTS_DIR}:`, error);
    }
    scheduleWatcherRestart();
    return null;
  }
};

// ============================================
// RESTAURATION DES FICHIERS SUPPRIMÉS
// ============================================

/**
 * Restaure tous les fichiers depuis deleted/ vers leur emplacement d'origine
 * Cela permet de réinitialiser l'état lors du redémarrage du serveur
 */
const restoreAllDeletedFiles = () => {
  if (!existsSync(DELETED_DIR)) {
    return;
  }

  console.log("↩️  Restauration des fichiers depuis deleted/");

  // Restaurer récursivement tous les fichiers depuis deleted/ vers public/Screenshots/
  const restoreRecursive = (deletedDir: string, basePath = "") => {
    if (!existsSync(deletedDir)) {
      return;
    }

    const entries = readdirSync(deletedDir);

    for (const entry of entries) {
      const deletedEntryPath = join(deletedDir, entry);
      const relativePath = join(basePath, entry).replace(/\\/g, "/");
      const stat = statSync(deletedEntryPath);

      if (stat.isDirectory()) {
        // Récursion dans les sous-dossiers
        restoreRecursive(deletedEntryPath, relativePath);
      } else if (entry.endsWith(SCREENSHOT_EXTENSION)) {
        // Restaurer le fichier
        const cleanPath = relativePath.replace(/^Screenshots\/deleted\//, "").replace(/^deleted\//, "");
        const absDeleted = join(DELETED_DIR, cleanPath);
        const absRestore = join(PUBLIC_SCREENSHOTS_DIR, cleanPath);

        if (existsSync(absDeleted)) {
          mkdirSync(dirname(absRestore), { recursive: true });
          renameSync(absDeleted, absRestore);
        }
      }
    }
  };

  try {
    restoreRecursive(DELETED_DIR);
    console.log("✅ Restauration terminée");
  } catch (err) {
    console.warn("⚠️  Erreur lors de la restauration:", err);
  }
};

// ============================================
// INITIALISATION DE L'INDEX
// ============================================

restoreAllDeletedFiles();
console.log("🔄 Initialisation de l'index des régressions");
refreshIndex(false);
watchScreenshotsDirectory();
warmStorybookIndexCache(getStorybookUrl(PROJECT_ROOT));

// ============================================
// SERVEUR HTTP (Node)
// ============================================

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", VR_SERVER_URL);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // ============================================
  // ROUTES DE LECTURE
  // ============================================

  if (req.method === "GET" && url.pathname === "/regressions/tree") {
    try {
      sendJson(res, { tree: index.tree, lastUpdate: index.lastUpdate });
    } catch (err) {
      console.error("❌ Error building tree:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/stories-tree — catalogue Storybook × devices (baseline / missing / ignored)
  if (req.method === "GET" && url.pathname === "/regressions/stories-tree") {
    try {
      const result = await buildStoriesTree(PROJECT_ROOT);
      sendJson(res, result);
    } catch (err) {
      console.error("❌ Error building stories tree:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/orphans-tree — screenshots disque sans story Storybook
  if (req.method === "GET" && url.pathname === "/regressions/orphans-tree") {
    try {
      const result = await buildOrphansTree(PROJECT_ROOT);
      sendJson(res, result);
    } catch (err) {
      console.error("❌ Error building orphans tree:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/config/devices - Config d'affichage des devices (pour l'UI, depuis vr.config.cjs)
  if (req.method === "GET" && url.pathname === "/regressions/config/devices") {
    try {
      const devices = getDevicesDisplayConfig(PROJECT_ROOT);
      sendJson(res, { devices });
    } catch (err) {
      console.error("❌ Error fetching devices config:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/config - Config VR publique résolue (vr.config.cjs + env)
  if (req.method === "GET" && url.pathname === "/regressions/config") {
    try {
      const publicConfig = getVrPublicConfig(PROJECT_ROOT);
      const storyCount = await countEligibleStorybookStories(publicConfig.storybookUrl);
      sendJson(res, { ...publicConfig, storyCount });
    } catch (err) {
      console.error("❌ Error fetching VR config:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/deleted - Récupérer les suppressions
  if (req.method === "GET" && url.pathname === "/regressions/deleted") {
    try {
      sendJson(res, { deleted: index.deletedItems, lastUpdate: index.lastUpdate });
    } catch (err) {
      console.error("❌ Error fetching deleted:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/validated - Historique des validations (revert possible)
  if (req.method === "GET" && url.pathname === "/regressions/validated") {
    try {
      sendJson(res, { validated: index.validatedItems, lastUpdate: index.lastUpdate });
    } catch (err) {
      console.error("❌ Error fetching validated:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/capture-errors — stories × devices en échec de capture
  if (req.method === "GET" && url.pathname === "/regressions/capture-errors") {
    try {
      const errors = await purgeIgnoredCaptureErrors(PROJECT_ROOT);
      sendJson(res, { errors, count: errors.length, lastUpdate: Date.now() });
    } catch (err) {
      console.error("❌ Error fetching capture errors:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/regressions/rebuild") {
    try {
      refreshIndex({ notify: true, allowEmpty: true });
      sendJson(res, {
        success: true,
        lastUpdate: index.lastUpdate,
        diffCount: index.diffPaths.length,
        newCount: index.newPaths.length,
      });
    } catch (err) {
      console.error("❌ Rebuild error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/regressions/metrics") {
    try {
      const imagePath = url.searchParams.get("path");
      if (!imagePath) {
        sendJson(res, { error: "Missing path query parameter" }, 400);
        return;
      }
      const countPixelDiff = getPixelDiffMetrics(imagePath);
      sendJson(res, { countPixelDiff });
    } catch (err) {
      console.error("❌ Error fetching metrics:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📡 GET /events - Server-Sent Events pour les notifications en temps réel
  if (req.method === "GET" && url.pathname === "/events") {
    const clientId = `client-${Date.now()}-${Math.random()}`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders,
    });
    const client: NodeSSEClient = { id: clientId, res };
    sseClients.add(client);
    res.write(`data: ${JSON.stringify({ type: "connected", clientId, lastUpdate: index.lastUpdate })}\n\n`);

    const pingIntervalRef = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(pingIntervalRef);
        sseClients.delete(client);
        console.log(`📡 Client SSE déconnecté (ping failed): ${clientId} (${sseClients.size} clients restants)`);
      }
    }, 30000);

    const cleanup = () => {
      clearInterval(pingIntervalRef);
      sseClients.delete(client);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    return;
  }

  // ============================================
  // ROUTES D'ÉCRITURE
  // ============================================

  /**
   * Archive une régression dans validated/ avant validation (permet le revert).
   * DIFF : original + __temp__ + __diff__ ; NEW : __new__ seulement.
   */
  const archiveValidation = (body: StoryScreenshotsPath, isDiffCase: boolean): void => {
    const files = isDiffCase ? [body.original, body.temp, body.diff].filter(Boolean) : [body.new].filter(Boolean);

    for (const p of files) {
      const rel = p!;
      if (!rel.startsWith(`${SCREENSHOTS_DIR}/`)) continue;
      const absSource = join(PUBLIC_DIR, rel);
      if (!existsSync(absSource)) continue;
      const cleanPath = rel.replace(/^Screenshots\//, "");
      const absTarget = join(VALIDATED_DIR, cleanPath);
      mkdirSync(dirname(absTarget), { recursive: true });
      copyFileSync(absSource, absTarget);
    }
  };

  /**
   * Valide une régression (new ou diff) : archive pour historique, puis déplace vers le Screenshots/ du composant.
   * @returns chemin cible relatif au projet
   */
  const validateRegression = (body: StoryScreenshotsPath): string => {
    const { temp, diff, new: newPath, original } = body || {};
    const isDiffCase = Boolean(diff && temp);
    const isNewCase = Boolean(newPath && !diff);

    if (!isDiffCase && !isNewCase) {
      throw new Error("Invalid validation: must have either (diff + temp) or (new)");
    }

    const source = isDiffCase ? temp : newPath;
    if (!source) {
      throw new Error("Missing source path");
    }

    const parts = source.split("/");
    if (parts[0] !== SCREENSHOTS_DIR) {
      throw new Error(`Invalid path format: expected to start with ${SCREENSHOTS_DIR}`);
    }

    const pathWithoutScreenshots = parts.slice(1);
    const fileName = pathWithoutScreenshots[pathWithoutScreenshots.length - 1];
    const componentPath = pathWithoutScreenshots.slice(0, -1);

    const cleanFileName = fileName.replace(
      new RegExp(
        `^${TEMP_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|^${NEW_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
      "",
    );

    archiveValidation(body, isDiffCase);

    const target = [...componentPath, SCREENSHOTS_DIR, cleanFileName].join("/");
    const absSource = join(PUBLIC_DIR, source);
    const absTarget = join(PROJECT_ROOT, target);
    if (!existsSync(absSource)) {
      throw new Error(`Source screenshot missing: ${source}`);
    }
    mkdirSync(dirname(absTarget), { recursive: true });
    renameSync(absSource, absTarget);

    if (isDiffCase) {
      if (diff) {
        try {
          rmSync(join(PUBLIC_DIR, diff), { force: true });
        } catch (err) {
          console.warn(`⚠️  Failed to delete diff ${diff}`, err);
        }
      }
      if (original) {
        try {
          rmSync(join(PUBLIC_DIR, original), { force: true });
        } catch (err) {
          console.warn(`⚠️  Failed to delete original ${original}`, err);
        }
      }
    }

    return target;
  };

  /**
   * Annule une validation : restaure la baseline précédente (diff) ou retire la NEW,
   * et remet les artefacts dans public/ pour réafficher la régression.
   */
  const revertValidated = (cleanPath: string, isDiff: boolean): void => {
    if (isDiff) {
      const { diff, temp, original } = getDiffScreenshotVariants(cleanPath);
      const filesToRestore = [diff, temp, original];
      let restoredCount = 0;

      for (const file of filesToRestore) {
        const absValidated = join(VALIDATED_DIR, file);
        const absPublic = join(PUBLIC_SCREENSHOTS_DIR, file);
        if (!existsSync(absValidated)) {
          console.warn(`⚠️  Not in validated/: ${file}`);
          continue;
        }
        if (existsSync(absPublic)) rmSync(absPublic, { force: true });
        mkdirSync(dirname(absPublic), { recursive: true });
        renameSync(absValidated, absPublic);
        restoredCount++;
      }

      if (restoredCount === 0) {
        throw new Error("No files found in validated/");
      }

      // Remettre l'ancienne baseline source (fichier original sans préfixe)
      const absPrevBaseline = join(PUBLIC_SCREENSHOTS_DIR, original);
      if (existsSync(absPrevBaseline)) {
        const parts = original.split("/");
        const baseName = parts[parts.length - 1];
        const componentDir = parts.slice(0, -1).join("/");
        const absSourceBaseline = join(PROJECT_ROOT, componentDir, SCREENSHOTS_DIR, baseName);
        mkdirSync(dirname(absSourceBaseline), { recursive: true });
        copyFileSync(absPrevBaseline, absSourceBaseline);
      }

      console.log(`↩️  Reverted validated diff ${formatScreenshotLogLabel(cleanPath)}`);
      return;
    }

    const absValidated = join(VALIDATED_DIR, cleanPath);
    const absPublic = join(PUBLIC_SCREENSHOTS_DIR, cleanPath);
    if (!existsSync(absValidated)) {
      throw new Error("Not found in validated/");
    }

    // Retirer la baseline source validée
    const parts = cleanPath
      .replace(new RegExp(`(^|/)${NEW_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "$1")
      .split("/");
    const baseName = parts[parts.length - 1];
    const componentDir = parts.slice(0, -1).join("/");
    const absSourceBaseline = join(PROJECT_ROOT, componentDir, SCREENSHOTS_DIR, baseName);
    if (existsSync(absSourceBaseline)) {
      rmSync(absSourceBaseline, { force: true });
    }

    mkdirSync(dirname(absPublic), { recursive: true });
    renameSync(absValidated, absPublic);
    console.log(`↩️  Reverted validated new ${formatScreenshotLogLabel(cleanPath)}`);
  };

  /** Refuse une régression : déplace les artefacts public vers deleted/ ; rm les baselines source orphelines. */
  const deleteRegression = (body: StoryScreenshotsPath): boolean => {
    const { temp, diff, new: newPath, original } = body || {};
    const files = [original, temp, diff, newPath].filter(Boolean);
    if (!files.length) {
      throw new Error("Missing paths");
    }

    let movedAny = false;
    for (const p of files) {
      const rel = p!;
      // Baseline co-localisée (orphelins source) : chemin relatif au projet, hors public/
      if (!rel.startsWith(`${SCREENSHOTS_DIR}/`)) {
        const absSource = join(PROJECT_ROOT, rel);
        const resolvedRoot = resolvePath(PROJECT_ROOT);
        const resolvedFile = resolvePath(absSource);
        if (
          (resolvedFile === resolvedRoot || resolvedFile.startsWith(resolvedRoot + path.sep)) &&
          existsSync(absSource)
        ) {
          rmSync(absSource, { force: true });
          movedAny = true;
        }
        continue;
      }

      const absSource = join(PUBLIC_DIR, rel);
      if (!existsSync(absSource)) continue;
      const cleanPath = rel.replace(/^Screenshots\//, "");
      const absTarget = join(DELETED_DIR, cleanPath);
      mkdirSync(dirname(absTarget), { recursive: true });
      renameSync(absSource, absTarget);
      movedAny = true;
    }

    if (movedAny) {
      const logPath = pickScreenshotPathForLog([original, diff, temp, newPath]);
      if (logPath) {
        console.log(`🗃️  Deleted ${formatScreenshotLogLabel(logPath)}`);
      }
    }

    return movedAny;
  };

  /** Chemins d'images à partir d'une entrée d'index (Screenshots/.../fichier.png). */
  const imagePathsFromIndexEntry = (relativePath: string): StoryScreenshotsPath => {
    const withoutScreenshots = relativePath.replace(/^Screenshots\//, "");
    return calculateImagePaths(withoutScreenshots);
  };

  // ✅ POST /validate - Valider une régression
  if (req.method === "POST" && url.pathname === "/validate") {
    try {
      const body = JSON.parse(await readBody(req)) as StoryScreenshotsPath;
      const target = validateRegression(body);
      refreshIndex(true);
      console.log(`✅ Validated: ${target}`);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Validate error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // ✅ POST /validate/all - Valider toutes les régressions en cours
  if (req.method === "POST" && url.pathname === "/validate/all") {
    try {
      const entries = [...index.diffPaths, ...index.newPaths];
      let validated = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          validateRegression(imagePathsFromIndexEntry(entry));
          validated++;
        } catch (err) {
          failed++;
          console.warn(`⚠️  Validate all skip ${entry}:`, err);
        }
      }
      refreshIndex(true);
      console.log(`✅ Validate all: ${validated} ok, ${failed} failed (${entries.length} total)`);
      sendJson(res, { success: true, validated, failed, total: entries.length });
    } catch (err) {
      console.error("❌ Validate all error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // ✅ POST /validate/selected - Valider une sélection de régressions
  if (req.method === "POST" && url.pathname === "/validate/selected") {
    try {
      const body = JSON.parse(await readBody(req)) as { items: StoryScreenshotsPath[] };
      const { items } = body || {};
      if (!Array.isArray(items) || items.length === 0) {
        sendJson(
          res,
          { success: false, error: "Missing or empty items array (expected { items: StoryScreenshotsPath[] })" },
          400,
        );
        return;
      }

      let validated = 0;
      let failed = 0;
      for (const item of items) {
        try {
          validateRegression(item);
          validated++;
        } catch (err) {
          failed++;
          console.warn(`⚠️  Validate selected skip:`, err);
        }
      }
      refreshIndex(true);
      console.log(`✅ Validate selected: ${validated} ok, ${failed} failed (${items.length} total)`);
      sendJson(res, { success: true, validated, failed, total: items.length });
    } catch (err) {
      console.error("❌ Validate selected error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🔍 POST /compare - Lancer la comparaison
  if (req.method === "POST" && url.pathname === "/compare") {
    try {
      refreshIndex({ notify: true, allowEmpty: true });
      const compareScript = path.join(SCRIPT_DIR, "compare-visual-regressions.ts");
      const compareMode = resolveVrConfig(PROJECT_ROOT).compare.mode;
      console.log(`🔍 Lancement comparaison VR (mode ${compareMode})`);
      const { command, args } = getNodeTsxArgs(compareScript);
      const compareProcess = spawn(command, args, {
        env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
        stdio: "inherit",
        ...spawnShellOption,
      });
      // Rafraîchir le cache après la comparaison et notifier les clients
      compareProcess.on("close", (code: number) => {
        console.log(`✅ Comparaison terminée (code: ${code})`);
        refreshIndex({ notify: true, allowEmpty: true });
      });
      sendJson(res, { success: true, message: "Comparaison lancée" });
    } catch (err) {
      console.error("❌ Compare error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🔍 POST /compare/single - Lancer la comparaison pour une story spécifique
  if (req.method === "POST" && url.pathname === "/compare/single") {
    try {
      const body = JSON.parse(await readBody(req)) as { storyId: string; deviceName: string; componentDir?: string };
      const { storyId, deviceName, componentDir } = body || {};
      if (!storyId || !deviceName) {
        sendJson(res, { success: false, error: "Missing storyId or deviceName" }, 400);
        return;
      }
      const { compareSingleStory } = await importCompareModule();
      runCompareAsync(`Comparaison ${deviceName}/${storyId}`, () =>
        compareSingleStory(storyId, deviceName, componentDir),
      );
      sendJson(res, { success: true, message: "Comparaison lancée" });
    } catch (err) {
      console.error("❌ Compare single error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🔍 POST /compare/by-type - Lancer la comparaison par type (new, diff, rejected, validated)
  if (req.method === "POST" && url.pathname === "/compare/by-type") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        type: "new" | "diff" | "rejected" | "validated";
        deviceName?: string;
        history?: "deleted" | "validated";
      };
      const { type, deviceName, history } = body || {};
      if (!type || !["new", "diff", "rejected", "validated"].includes(type)) {
        sendJson(
          res,
          { success: false, error: "Missing or invalid type (must be 'new', 'diff', 'rejected', or 'validated')" },
          400,
        );
        return;
      }
      const { compareByType } = await importCompareModule();
      runCompareAsync(`Comparaison type ${type}${deviceName ? ` (${deviceName})` : ""}`, () =>
        compareByType(type, deviceName, history),
      );
      sendJson(res, {
        success: true,
        message: `Comparaison lancée pour le type ${type}${deviceName ? ` sur ${deviceName}` : ""}`,
      });
    } catch (err) {
      console.error("❌ Compare by type error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🔍 POST /compare/all-stories - Régénérer toutes les stories pour un device (ou tous les devices si non spécifié)
  if (req.method === "POST" && url.pathname === "/compare/all-stories") {
    try {
      const body = JSON.parse(await readBody(req)) as { deviceName?: string };
      const { deviceName } = body || {};
      const { compareAllStories } = await importCompareModule();
      runCompareAsync(
        `Régénération toutes les stories${deviceName ? ` (${deviceName})` : ""}`,
        () =>
          compareAllStories(deviceName, {
            onDirectoryWiped: () => refreshIndex({ notify: true, allowEmpty: true }),
          }),
        { allowEmptyRefresh: true },
      );
      sendJson(res, {
        success: true,
        message: `Régénération lancée pour toutes les stories${deviceName ? ` sur ${deviceName}` : " (tous les devices)"}`,
      });
    } catch (err) {
      console.error("❌ Compare all stories error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🔍 POST /compare/selected - Régénérer une sélection de stories (même flux que by-type / all-stories)
  if (req.method === "POST" && url.pathname === "/compare/selected") {
    try {
      const body = JSON.parse(await readBody(req)) as { stories: StoryDevicePair[] };
      const { stories } = body || {};
      if (!Array.isArray(stories) || stories.length === 0) {
        sendJson(
          res,
          { success: false, error: "Missing or empty stories array (expected { storyId, deviceName }[])" },
          400,
        );
        return;
      }

      const { compareSelectedStories } = await importCompareModule();
      runCompareAsync(`Régénération sélection (${stories.length})`, () => compareSelectedStories(stories));
      sendJson(res, {
        success: true,
        message: `Régénération lancée pour ${stories.length} comparaison${stories.length > 1 ? "s" : ""}`,
      });
    } catch (err) {
      console.error("❌ Compare selected error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/delete") {
    try {
      const body = JSON.parse(await readBody(req)) as StoryScreenshotsPath;
      deleteRegression(body);
      refreshIndex(true);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Delete error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🗃️ POST /delete/all - Refuser toutes les régressions en cours
  if (req.method === "POST" && url.pathname === "/delete/all") {
    try {
      const entries = [...index.diffPaths, ...index.newPaths];
      let deleted = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          if (deleteRegression(imagePathsFromIndexEntry(entry))) deleted++;
        } catch (err) {
          failed++;
          console.warn(`⚠️  Delete all skip ${entry}:`, err);
        }
      }
      refreshIndex(true);
      console.log(`🗃️  Delete all: ${deleted} ok, ${failed} failed (${entries.length} total)`);
      sendJson(res, { success: true, deleted, failed, total: entries.length });
    } catch (err) {
      console.error("❌ Delete all error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🗃️ POST /delete/selected - Refuser / supprimer une sélection de régressions
  if (req.method === "POST" && url.pathname === "/delete/selected") {
    try {
      const body = JSON.parse(await readBody(req)) as { items: StoryScreenshotsPath[] };
      const { items } = body || {};
      if (!Array.isArray(items) || items.length === 0) {
        sendJson(
          res,
          { success: false, error: "Missing or empty items array (expected { items: StoryScreenshotsPath[] })" },
          400,
        );
        return;
      }

      let deleted = 0;
      let failed = 0;
      for (const item of items) {
        try {
          if (deleteRegression(item)) deleted++;
        } catch (err) {
          failed++;
          console.warn(`⚠️  Delete selected skip:`, err);
        }
      }
      refreshIndex(true);
      console.log(`🗃️  Delete selected: ${deleted} ok, ${failed} failed (${items.length} total)`);
      sendJson(res, { success: true, deleted, failed, total: items.length });
    } catch (err) {
      console.error("❌ Delete selected error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/restore") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        path: string;
        isDiff: boolean;
      };
      const { path, isDiff } = body || {};

      if (!path) {
        throw new Error("Missing path");
      }

      // Nettoyer le path au cas où il contiendrait des préfixes
      const cleanPath = path
        .replace(/^public\//, "") // Retire "public/" si présent
        .replace(/^Screenshots\/deleted\//, "") // Retire "Screenshots/deleted/"
        .replace(/^Screenshots\//, ""); // Retire "Screenshots/"

      if (isDiff) {
        const { diff, temp, original } = getDiffScreenshotVariants(cleanPath);
        const filesToRestore = [diff, temp, original];

        let restoredCount = 0;
        for (const file of filesToRestore) {
          const absDeleted = join(DELETED_DIR, file);
          const absRestore = join(PUBLIC_SCREENSHOTS_DIR, file);

          if (!existsSync(absDeleted)) {
            console.warn(`⚠️  Not in deleted/: ${file}`);
            continue;
          }

          if (existsSync(absRestore)) {
            rmSync(absRestore, { force: true });
          }

          mkdirSync(dirname(absRestore), { recursive: true });
          renameSync(absDeleted, absRestore);
          restoredCount++;
        }

        if (restoredCount === 0) {
          sendJson(res, { success: false, error: "No files found in deleted/" }, 400);
          return;
        }

        console.log(`↩️  Restored ${formatScreenshotLogLabel(cleanPath)}`);
      } else {
        const absDeleted = join(DELETED_DIR, cleanPath);
        const absRestore = join(PUBLIC_SCREENSHOTS_DIR, cleanPath);
        if (!existsSync(absDeleted)) {
          console.warn(`⚠️  Not in deleted/: ${cleanPath}`);
          console.warn(`⚠️  Chemin complet vérifié: ${absDeleted}`);
          sendJson(res, { success: false, error: "Not found in deleted/" }, 400);
          return;
        }

        mkdirSync(dirname(absRestore), { recursive: true });
        renameSync(absDeleted, absRestore);
        console.log(`↩️  Restored ${formatScreenshotLogLabel(cleanPath)}`);
      }

      refreshIndex(true);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Restore error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // ↩️ POST /revert-validated — annuler une validation (baseline précédente + régression public)
  if (req.method === "POST" && url.pathname === "/revert-validated") {
    try {
      const body = JSON.parse(await readBody(req)) as { path: string; isDiff: boolean };
      const { path: rawPath, isDiff } = body || {};
      if (!rawPath) throw new Error("Missing path");

      const cleanPath = rawPath
        .replace(/^public\//, "")
        .replace(new RegExp(`^Screenshots/${VALIDATED_DIR_NAME}/`), "")
        .replace(/^Screenshots\//, "");

      revertValidated(cleanPath, Boolean(isDiff));
      refreshIndex(true);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Revert validated error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  const streamImageFile = (filePath: string) => {
    const contentType = filePath.endsWith(".png")
      ? "image/png"
      : filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")
        ? "image/jpeg"
        : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache", ...corsHeaders });
    const stream = createReadStream(filePath);
    stream.on("error", err => {
      console.warn(`⚠️  Error streaming ${filePath}:`, err);
      if (!res.headersSent) {
        res.writeHead(404, corsHeaders);
        res.end("File not found");
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  };

  // Orphelins source : /project-file/src/.../*.screenshot.png (dossier Screenshots optionnel)
  if (req.method === "GET" && url.pathname.startsWith("/project-file/")) {
    try {
      const rel = decodeURIComponent(url.pathname.slice("/project-file/".length)).replace(/\\/g, "/");
      const baseName = rel.split("/").pop() ?? "";
      const underSrc = rel.startsWith("src/") || rel.includes("/src/");
      const looksLikeScreenshot =
        baseName.endsWith(SCREENSHOT_EXTENSION) &&
        (baseName.includes(".screenshot.") || baseName.includes(".screenshot "));
      if (!rel || rel.includes("..") || !underSrc || !looksLikeScreenshot) {
        res.writeHead(403, corsHeaders);
        res.end("Forbidden");
        return;
      }
      const resolvedRoot = resolvePath(PROJECT_ROOT);
      const filePath = resolvePath(join(PROJECT_ROOT, ...rel.split("/").filter(Boolean)));
      if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
        res.writeHead(403, corsHeaders);
        res.end("Forbidden");
        return;
      }
      if (!existsSync(filePath)) {
        res.writeHead(404, corsHeaders);
        res.end("File not found");
        return;
      }
      streamImageFile(filePath);
    } catch (err) {
      console.error("❌ Error serving project file:", err);
      if (!res.headersSent) {
        res.writeHead(500, corsHeaders);
        res.end("Internal Server Error");
      }
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/Screenshots/")) {
    try {
      // url.pathname est du type "/Screenshots/src/..." ; sur Windows il faut joindre avec PUBLIC_DIR sans que le "/" soit interprété comme absolu
      const pathSegments = url.pathname.replace(/^\/+/, "").split("/");
      const filePath = join(PUBLIC_DIR, ...pathSegments);
      if (!existsSync(filePath)) {
        res.writeHead(404, corsHeaders);
        res.end("File not found");
        return;
      }
      streamImageFile(filePath);
    } catch (err) {
      console.error("❌ Error serving file:", err);
      if (!res.headersSent) {
        res.writeHead(500, corsHeaders);
        res.end("Internal Server Error");
      }
    }
    return;
  }

  sendJson(res, { message: "Not Found" }, 404);
};

createServer(handler).listen(VR_SERVER_PORT, () => {
  console.log(`🟢 VR server started on ${VR_SERVER_URL}`);
  console.log(`📊 ${index.diffPaths.length} diffs, ${index.newPaths.length} nouveaux screenshots détectés`);
});
