// scripts/vr-server.ts (package @setshao/visual-regression)
import { spawn } from "child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
} from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { createServer } from "http";
import path from "path";
import { pathToFileURL } from "url";

import { PNG } from "pngjs";

import {
  DIFF_SCREENSHOT_NAME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
  TREE_BASE_FOLDER,
  VR_SERVER_PORT,
  VR_SERVER_URL,
} from "../constants/constants";
import type {
  DeletedItem,
  Node,
  ParsedPath,
  RegressionIndex,
  StoryDevicePair,
  StoryScreenshotsPath,
} from "../types/types";
import {
  getDevicesDisplayConfig,
  getDevicesNames,
  getNodeTsxArgs,
  getProjectPaths,
  getProjectRoot,
  getScriptDir,
  getVrPublicConfig,
  countEligibleStorybookStories,
  resolveVrConfig,
  spawnShellOption,
} from "../utils/node";

const PROJECT_ROOT = getProjectRoot();
const {
  publicDir: PUBLIC_DIR,
  publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR,
  deletedDir: DELETED_DIR,
} = getProjectPaths(PROJECT_ROOT);
const DEVICES = getDevicesNames(resolveVrConfig(PROJECT_ROOT).devices);
const SCRIPT_DIR = getScriptDir(import.meta);
const join = path.join;
const dirname = path.dirname;

const importCompareModule = () => import(pathToFileURL(join(SCRIPT_DIR, "compare-visual-regressions.ts")).href);

// ============================================
// INDEX DES RÉGRESSIONS (en mémoire)
// ============================================

/**
 * Scan optimisé qui parcourt une seule fois PUBLIC_SCREENSHOTS_DIR (incluant deleted/) et catégorise les fichiers
 */
const scanAllScreenshots = (): { diffPaths: string[]; newPaths: string[]; deletedPaths: string[] } => {
  const diffPaths: string[] = [];
  const newPaths: string[] = [];
  const deletedPaths: string[] = [];

  // Scanner PUBLIC_SCREENSHOTS_DIR une seule fois (incluant le dossier deleted/)
  if (existsSync(PUBLIC_SCREENSHOTS_DIR)) {
    const scanScreenshots = (currentDir: string) => {
      try {
        const files = readdirSync(currentDir);

        for (const file of files) {
          const fullPath = join(currentDir, file);
          const stat = statSync(fullPath);

          if (stat.isDirectory()) {
            // Inclure le dossier "deleted" dans le scan récursif
            scanScreenshots(fullPath);
          } else if (file.endsWith(SCREENSHOT_EXTENSION)) {
            const rawRelative = fullPath.replace(PUBLIC_DIR, "");
            const relativePath = rawRelative.replace(/\\/g, "/").replace(/^\/+/, "");
            const isInDeleted = relativePath.includes("/deleted/");

            if (isInDeleted) {
              if (file.includes(DIFF_SCREENSHOT_NAME) || file.includes(NEW_SCREENSHOT_NAME)) {
                deletedPaths.push(relativePath);
              }
            } else {
              if (file.includes(DIFF_SCREENSHOT_NAME)) {
                diffPaths.push(relativePath);
              } else if (file.includes(NEW_SCREENSHOT_NAME)) {
                newPaths.push(relativePath);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`⚠️  Error scanning ${currentDir}:`, err);
      }
    };

    scanScreenshots(PUBLIC_SCREENSHOTS_DIR);
  }

  return { diffPaths, newPaths, deletedPaths };
};

// ============================================
// UTILITAIRES
// ============================================

/**
 * Extrait le nom du device depuis un nom de fichier
 * Format attendu: {deviceName}-{storyId}.screenshot.png ou __{type}__{deviceName}-{storyId}.screenshot.png
 */
const extractDeviceName = (fileName: string): { deviceName: string | null; storyId: string } => {
  // Retirer d'abord les préfixes __diff__, __new__, __temp__ s'ils sont présents au début
  let cleanFileName = fileName;

  if (cleanFileName.startsWith(DIFF_SCREENSHOT_NAME)) {
    cleanFileName = cleanFileName.replace(DIFF_SCREENSHOT_NAME, "");
  } else if (cleanFileName.startsWith(NEW_SCREENSHOT_NAME)) {
    cleanFileName = cleanFileName.replace(NEW_SCREENSHOT_NAME, "");
  } else if (cleanFileName.startsWith(TEMP_SCREENSHOT_NAME)) {
    cleanFileName = cleanFileName.replace(TEMP_SCREENSHOT_NAME, "");
  }

  // Chercher le premier device qui correspond au début du nom de fichier (après le préfixe)
  for (const deviceName of DEVICES) {
    if (cleanFileName.startsWith(deviceName + "-")) {
      // Retirer le préfixe du device et l'extension
      const storyId = cleanFileName.replace(deviceName + "-", "").replace(".screenshot" + SCREENSHOT_EXTENSION, "");
      return { deviceName, storyId };
    }
  }

  // Si aucun device ne correspond, retourner le nom complet sans préfixe
  const storyId = cleanFileName.replace(".screenshot" + SCREENSHOT_EXTENSION, "");
  return { deviceName: null, storyId };
};

const parsePath = (filePath: string): ParsedPath | null => {
  const normalized = filePath.replace(/\\/g, "/");
  const cleanPath = normalized.replace(/^Screenshots\/deleted\//, "");

  const segments = cleanPath.split("/");
  const baseIdx = segments.indexOf(TREE_BASE_FOLDER);

  if (baseIdx === -1) return null;

  const relevant = segments.slice(baseIdx);
  const fileName = relevant[relevant.length - 1];
  const folders = relevant.slice(1, -1);

  // Extraire le device et le storyId
  const { deviceName, storyId } = extractDeviceName(fileName);

  // Construire le label avec le device si présent
  const label = deviceName ? `${deviceName} - ${storyId}` : storyId;

  return { folders, fileName, label, deviceName: deviceName || undefined };
};

const splitCleanPath = (cleanPath: string): { dirPrefix: string; fileName: string } => {
  const normalized = cleanPath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dirPrefix: "", fileName: normalized };
  }
  return {
    dirPrefix: normalized.slice(0, lastSlash + 1),
    fileName: normalized.slice(lastSlash + 1),
  };
};

/** Libellé compact pour les logs delete/restore : `{device}-{storyId} | {componentDir}`. */
const formatScreenshotLogLabel = (cleanPath: string): string => {
  const normalized = cleanPath.replace(/\\/g, "/").replace(/^Screenshots\//, "");
  const lastSlash = normalized.lastIndexOf("/");
  const componentDir = lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const { deviceName, storyId } = extractDeviceName(fileName);
  const screenshotKey = deviceName ? `${deviceName}-${storyId}` : storyId;
  return componentDir ? `${screenshotKey} | ${componentDir}` : screenshotKey;
};

/** Chemin préféré pour le libellé de log (original > diff > temp > new). */
const pickScreenshotPathForLog = (paths: (string | undefined)[]): string | null => {
  const score = (p: string): number => {
    if (p.includes(DIFF_SCREENSHOT_NAME)) return 1;
    if (p.includes(TEMP_SCREENSHOT_NAME)) return 2;
    if (p.includes(NEW_SCREENSHOT_NAME)) return 3;
    return 0;
  };
  const candidates = paths.filter((p): p is string => Boolean(p)).map(p => p.replace(/^Screenshots\//, ""));
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => score(a) - score(b))[0];
};

/** Chemins relatifs (sans Screenshots/) des 3 fichiers d'une régression diff. */
const getDiffScreenshotVariants = (cleanPath: string): { diff: string; temp: string; original: string } => {
  const { dirPrefix, fileName } = splitCleanPath(cleanPath);

  const removePrefix = (name: string, prefix: string): string =>
    name.startsWith(prefix) ? name.slice(prefix.length) : name;

  const replacePrefix = (name: string, oldPrefix: string, newPrefix: string): string =>
    name.startsWith(oldPrefix) ? newPrefix + name.slice(oldPrefix.length) : name;

  const diffFileName = fileName.startsWith(DIFF_SCREENSHOT_NAME)
    ? fileName
    : fileName.startsWith(TEMP_SCREENSHOT_NAME)
      ? replacePrefix(fileName, TEMP_SCREENSHOT_NAME, DIFF_SCREENSHOT_NAME)
      : DIFF_SCREENSHOT_NAME + fileName;

  const baseFileName = removePrefix(removePrefix(diffFileName, DIFF_SCREENSHOT_NAME), TEMP_SCREENSHOT_NAME);

  return {
    diff: `${dirPrefix}${diffFileName}`,
    temp: `${dirPrefix}${TEMP_SCREENSHOT_NAME}${baseFileName}`,
    original: `${dirPrefix}${baseFileName}`,
  };
};

/**
 * Calcule les chemins d'images (original, temp, diff, new) pour un fichier
 */
const calculateImagePaths = (filePath: string): StoryScreenshotsPath => {
  const currentStoryPath = SCREENSHOTS_DIR + "/" + filePath;
  const isDiffScreenshot = currentStoryPath.includes(DIFF_SCREENSHOT_NAME);

  // Le préfixe est maintenant au début du nom de fichier
  // Extraire le nom de fichier et remplacer le préfixe au début
  const pathParts = currentStoryPath.split("/");
  const fileName = pathParts[pathParts.length - 1];
  const dirPath = pathParts.slice(0, -1).join("/");

  const removePrefix = (name: string, prefix: string): string => {
    return name.startsWith(prefix) ? name.substring(prefix.length) : name;
  };

  const replacePrefix = (name: string, oldPrefix: string, newPrefix: string): string => {
    return name.startsWith(oldPrefix) ? newPrefix + name.substring(oldPrefix.length) : name;
  };

  return {
    original: isDiffScreenshot ? `${dirPath}/${removePrefix(fileName, DIFF_SCREENSHOT_NAME)}` : undefined,
    temp: isDiffScreenshot
      ? `${dirPath}/${replacePrefix(fileName, DIFF_SCREENSHOT_NAME, TEMP_SCREENSHOT_NAME)}`
      : undefined,
    diff: isDiffScreenshot ? currentStoryPath : undefined,
    // Pour les fichiers new, utiliser le chemin tel quel car il contient déjà le préfixe __new__ si présent
    new: isDiffScreenshot ? undefined : currentStoryPath,
  };
};

/**
 * Compte les pixels rouges dans une image diff pour calculer countPixelDiff
 */
const countRedPixelsInDiffImage = (diffImagePath: string): number | null => {
  try {
    if (!existsSync(diffImagePath)) {
      return null;
    }

    const img = PNG.sync.read(readFileSync(diffImagePath));
    const data = img.data;
    let redPixels = 0;

    // Compter les pixels rouges (#ff0000 ou proche)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Pixels rouges (R=255, G=0, B=0) avec une petite tolérance
      if (r > 200 && g < 50 && b < 50) {
        redPixels++;
      }
    }

    return redPixels;
  } catch (err) {
    console.warn(`⚠️  Error counting pixels for ${diffImagePath}:`, err);
    return null;
  }
};

/**
 * Construit l'URL complète d'une image
 */
const getImageUrl = (path: string | undefined, version?: number): string | undefined => {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;

  // Normaliser les antislash (Windows) en slash pour les URLs
  let cleanPath = path.replace(/\\/g, "/").replace(/^public\//, "");

  // Nettoyer les chemins qui contiennent déjà "Screenshots/deleted/" pour éviter la duplication
  // Si le chemin commence déjà par "Screenshots/deleted/", le retourner tel quel après nettoyage
  if (cleanPath.startsWith("Screenshots/deleted/")) {
    // Retirer les duplications potentielles comme "Screenshots/deleted/public/Screenshots/deleted/"
    cleanPath = cleanPath
      .replace(/^Screenshots\/deleted\/public\/Screenshots\/deleted\//, "Screenshots/deleted/")
      .replace(/^Screenshots\/deleted\/public\//, "Screenshots/deleted/");
    const base = `${VR_SERVER_URL}/${cleanPath}`;
    return version !== undefined ? `${base}?v=${version}` : base;
  }

  // Pour les chemins de deleted qui commencent directement par "src/", on reconstruit
  if (cleanPath.startsWith("src/")) {
    const base = `${VR_SERVER_URL}/Screenshots/deleted/${cleanPath}`;
    return version !== undefined ? `${base}?v=${version}` : base;
  }

  // S'assurer que le chemin commence par "Screenshots/" pour correspondre au serveur VR
  if (!cleanPath.startsWith("Screenshots/")) {
    cleanPath = `Screenshots/${cleanPath}`;
  }

  const base = `${VR_SERVER_URL}/${cleanPath}`;
  return version !== undefined ? `${base}?v=${version}` : base;
};

/**
 * Extrait le storyId d'un node pour le tri
 */
const getStoryId = (node: Node): string => {
  // Pour les fichiers, le format est: "{deviceName} - {storyId}"
  if (node.name.includes(" - ")) {
    return node.name.split(" - ")[1];
  }
  // Pour les dossiers ou fichiers sans device, utiliser le nom complet
  return node.name;
};

/**
 * Extrait le deviceName d'un node pour le tri
 */
const getDeviceName = (node: Node): string => {
  // Pour les fichiers, le format est: "{deviceName} - {storyId}"
  if (node.name.includes(" - ")) {
    return node.name.split(" - ")[0];
  }
  // Pour les dossiers ou fichiers sans device, utiliser une chaîne vide pour le tri
  return "";
};

const buildTree = (files: string[], baseDir: string, version: number): Node => {
  const root: Node = {
    type: "folder",
    name: baseDir,
    path: baseDir + "/",
    children: {},
  };

  for (const file of files) {
    const parsedPath = parsePath(file);
    if (!parsedPath) continue;

    const { folders, fileName, label, deviceName } = parsedPath;

    let current = root;
    let currentPath = TREE_BASE_FOLDER + "/";

    for (const folder of folders) {
      currentPath += folder + "/";
      if (!current.children![folder]) {
        current.children![folder] = {
          type: "folder",
          name: folder,
          path: currentPath,
          children: {},
        };
      }
      current = current.children![folder];
    }

    // Utiliser le label complet (qui inclut le device) comme clé
    // Si plusieurs fichiers ont le même label (même story, devices différents), on les regroupe
    if (!current.children![label]) {
      const filePath = current.path + fileName;
      const isDiff = file.includes(DIFF_SCREENSHOT_NAME);
      const isNew = file.includes(NEW_SCREENSHOT_NAME);
      const storyType = isDiff ? "diff" : isNew ? "new" : undefined;

      // Extraire le storyId et le displayName
      const storyId = parsedPath.label.includes(" - ") ? parsedPath.label.split(" - ")[1] : parsedPath.label;
      const displayName = storyId.includes("--") ? storyId.split("--").pop() || storyId : storyId;

      // Calculer les chemins d'images
      const imagePaths = calculateImagePaths(filePath);
      const imageUrls = {
        original: getImageUrl(imagePaths.original, version),
        temp: getImageUrl(imagePaths.temp, version),
        diff: getImageUrl(imagePaths.diff, version),
        new: getImageUrl(imagePaths.new, version),
      };

      current.children![label] = {
        type: "file",
        name: label,
        path: filePath,
        storyType,
        deviceName,
        storyId,
        displayName,
        imagePaths,
        imageUrls,
      };
    }
  }

  // Calculer les compteurs pour chaque dossier après avoir construit l'arbre
  calculateCounts(root);

  return root;
};

/**
 * Calcule récursivement les compteurs (diff, new, total) pour chaque dossier
 */
const calculateCounts = (node: Node): void => {
  if (node.type === "file") {
    // Les fichiers n'ont pas de compteurs
    return;
  }

  let countDiff = 0;
  let countNew = 0;
  let countTotal = 0;

  if (node.children) {
    for (const child of Object.values(node.children)) {
      if (child.type === "file") {
        countTotal++;
        if (child.storyType === "diff") {
          countDiff++;
        } else if (child.storyType === "new") {
          countNew++;
        }
      } else {
        // Pour les dossiers, calculer récursivement d'abord
        calculateCounts(child);
        // Ensuite, ajouter les compteurs du sous-dossier
        countDiff += child.countDiff || 0;
        countNew += child.countNew || 0;
        countTotal += child.countTotal || 0;
      }
    }
  }

  node.countDiff = countDiff;
  node.countNew = countNew;
  node.countTotal = countTotal;
};

/**
 * Trie récursivement l'arbre par storyId puis par deviceName
 */
const sortTree = (node: Node): Node => {
  if (node.type === "file") {
    return node;
  }

  const sortedChildren: Record<string, Node> = {};
  const entries = Object.values(node.children ?? {}).sort((a, b) => {
    const storyIdA = getStoryId(a);
    const storyIdB = getStoryId(b);
    const storyIdCompare = storyIdA.localeCompare(storyIdB);

    // Si les storyId sont identiques, trier par deviceName
    if (storyIdCompare !== 0) {
      return storyIdCompare;
    }

    const deviceNameA = getDeviceName(a);
    const deviceNameB = getDeviceName(b);
    return deviceNameA.localeCompare(deviceNameB);
  });

  for (const child of entries) {
    sortedChildren[child.name] = sortTree(child);
  }

  return {
    ...node,
    children: sortedChildren,
    // Préserver les compteurs lors du tri
    countDiff: node.countDiff,
    countNew: node.countNew,
    countTotal: node.countTotal,
  };
};

const parseDeleted = (filePath: string): DeletedItem | null => {
  const parsed = parsePath(filePath);
  if (!parsed) return null;

  const isDiff = parsed.fileName.includes(DIFF_SCREENSHOT_NAME);

  // filePath vient du scan : "Screenshots/deleted/src/atoms/Alert/__diff__desktop-fhd-..."
  // On veut juste : "src/atoms/Alert/__diff__desktop-fhd-..."
  // Nettoyer agressivement pour retirer tous les préfixes possibles (y compris "public/")
  const cleanPath = filePath
    .replace(/^public\//, "") // Retire "public/" en premier
    .replace(/^Screenshots\/deleted\/public\/Screenshots\/deleted\//, "") // Retire le pattern dupliqué complet
    .replace(/^Screenshots\/deleted\/public\//, "") // Retire "Screenshots/deleted/public/"
    .replace(/^Screenshots\/deleted\//, "") // Retire "Screenshots/deleted/"
    .replace(/^Screenshots\//, ""); // Retire "Screenshots/" au cas où

  // Pour les diff, on affiche l'image __temp__, pour les new on affiche __new__
  // Le préfixe est maintenant au début, donc on remplace __diff__ par __temp__ au début
  const imagePath = isDiff
    ? cleanPath.replace(
        new RegExp(`^${DIFF_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        TEMP_SCREENSHOT_NAME,
      )
    : cleanPath; // Pour __new__, on garde tel quel

  // Construire l'URL complète pour l'image (imagePath commence déjà par "src/")
  const imageUrl = getImageUrl(`Screenshots/deleted/${imagePath}`);

  // Extraire le storyId
  const storyId = parsed.label.includes(" - ") ? parsed.label.split(" - ")[1] : parsed.label;

  return {
    ...parsed,
    isDiff,
    fullPath: cleanPath,
    imagePath,
    imageUrl,
    storyId,
  };
};

const buildDeletedItems = (deletedPaths: string[]): DeletedItem[] =>
  deletedPaths
    .filter(p => p.includes(DIFF_SCREENSHOT_NAME) || p.includes(NEW_SCREENSHOT_NAME))
    .map(parseDeleted)
    .filter(Boolean) as DeletedItem[];

const buildIndexFromScan = (): RegressionIndex => {
  const { diffPaths, newPaths, deletedPaths } = scanAllScreenshots();
  const lastUpdate = Date.now();
  const allPaths = [...diffPaths, ...newPaths];
  const rawTree = allPaths.length ? buildTree(allPaths, TREE_BASE_FOLDER, lastUpdate) : null;

  return {
    diffPaths,
    newPaths,
    deletedPaths,
    tree: rawTree ? sortTree(rawTree) : null,
    deletedItems: buildDeletedItems(deletedPaths),
    lastUpdate,
  };
};

let index: RegressionIndex = {
  diffPaths: [],
  newPaths: [],
  deletedPaths: [],
  tree: null,
  deletedItems: [],
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

  // ✅ POST /validate - Valider une régression
  if (req.method === "POST" && url.pathname === "/validate") {
    try {
      const body = JSON.parse(await readBody(req)) as StoryScreenshotsPath;
      const { temp, diff, new: newPath, original } = body || {};

      // Déterminer si c'est un cas diff (présence de diff et temp) ou new (présence de new)
      const isDiffCase = diff && temp;
      const isNewCase = newPath && !diff;

      if (!isDiffCase && !isNewCase) {
        throw new Error("Invalid validation: must have either (diff + temp) or (new)");
      }

      // Pour diff : on garde temp et on supprime diff + original
      // Pour new : on garde new
      const source = isDiffCase ? temp : newPath;
      if (!source) {
        throw new Error("Missing source path");
      }

      // Le chemin source est de la forme: Screenshots/src/atoms/Alert/__temp__fichier.png ou __new__fichier.png
      // On veut construire: src/atoms/Alert/Screenshots/fichier.png
      const parts = source.split("/");

      // Retirer "Screenshots" du début
      if (parts[0] !== SCREENSHOTS_DIR) {
        throw new Error(`Invalid path format: expected to start with ${SCREENSHOTS_DIR}`);
      }

      // Retirer "Screenshots" du début et extraire le reste
      const pathWithoutScreenshots = parts.slice(1);
      const fileName = pathWithoutScreenshots[pathWithoutScreenshots.length - 1];
      const componentPath = pathWithoutScreenshots.slice(0, -1);

      // Retirer le préfixe __temp__ ou __new__ du nom de fichier uniquement
      const cleanFileName = fileName.replace(
        new RegExp(
          `^${TEMP_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|^${NEW_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
        "",
      );

      // Construire le chemin cible: src/atoms/Alert/Screenshots/fichier.png
      const target = [...componentPath, SCREENSHOTS_DIR, cleanFileName].join("/");

      const absSource = join(PUBLIC_DIR, source);
      const absTarget = join(".", target); // Chemin relatif depuis la racine du projet
      mkdirSync(dirname(absTarget), { recursive: true });

      // Déplacer le fichier source vers le dossier Screenshots/ à côté de la story
      renameSync(absSource, absTarget);

      // Suppression des fichiers associés selon le cas
      if (isDiffCase) {
        // Pour diff : supprimer diff et original (temp a déjà été déplacé)
        if (diff) {
          try {
            const absDiff = join(PUBLIC_DIR, diff);
            rmSync(absDiff, { force: true });
          } catch (err) {
            console.warn(`⚠️  Failed to delete diff ${diff}`, err);
          }
        }
        if (original) {
          try {
            const absOriginal = join(PUBLIC_DIR, original);
            rmSync(absOriginal, { force: true });
          } catch (err) {
            console.warn(`⚠️  Failed to delete original ${original}`, err);
          }
        }
      } else if (isNewCase) {
        // Pour new : le fichier new a déjà été déplacé via renameSync
        // Il n'y a rien d'autre à supprimer car c'est une nouvelle image
      }

      // Rafraîchir le cache et notifier les clients
      refreshIndex(true);

      console.log(`✅ Validated (${isDiffCase ? "diff" : "new"}): ${target}`);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Validate error:", err);
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
      // Importer et appeler la fonction de comparaison pour une story spécifique
      const { compareSingleStory } = await importCompareModule();
      const result = await compareSingleStory(storyId, deviceName, componentDir);
      if (result.success) {
        // Rafraîchir le cache après la comparaison et notifier les clients
        refreshIndex(true);
        sendJson(res, { success: true, message: "Comparaison lancée" });
      } else {
        sendJson(res, { success: false, error: result.error || "Unknown error" }, 500);
      }
    } catch (err) {
      console.error("❌ Compare single error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 🔍 POST /compare/by-type - Lancer la comparaison par type (new, diff, rejected) et optionnellement par device
  if (req.method === "POST" && url.pathname === "/compare/by-type") {
    try {
      const body = JSON.parse(await readBody(req)) as { type: "new" | "diff" | "rejected"; deviceName?: string };
      const { type, deviceName } = body || {};
      if (!type || !["new", "diff", "rejected"].includes(type)) {
        sendJson(res, { success: false, error: "Missing or invalid type (must be 'new', 'diff', or 'rejected')" }, 400);
        return;
      }
      // Importer et appeler la fonction de comparaison par type
      const { compareByType } = await importCompareModule();
      const result = await compareByType(type, deviceName);
      if (result.success) {
        // Rafraîchir le cache après la comparaison et notifier les clients
        refreshIndex(true);
        sendJson(res, {
          success: true,
          message: `Comparaison lancée pour le type ${type}${deviceName ? ` sur ${deviceName}` : ""}`,
        });
      } else {
        sendJson(res, { success: false, error: result.error || "Unknown error" }, 500);
      }
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
      const result = await compareAllStories(deviceName, {
        onDirectoryWiped: () => refreshIndex({ notify: true, allowEmpty: true }),
      });
      if (result.success) {
        refreshIndex({ notify: true, allowEmpty: true });
        sendJson(res, {
          success: true,
          message: `Régénération lancée pour toutes les stories${deviceName ? ` sur ${deviceName}` : " (tous les devices)"}`,
        });
      } else {
        sendJson(res, { success: false, error: result.error || "Unknown error" }, 500);
      }
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
      const result = await compareSelectedStories(stories);
      if (result.success) {
        refreshIndex(true);
        sendJson(res, {
          success: true,
          message: `Régénération lancée pour ${stories.length} comparaison${stories.length > 1 ? "s" : ""}`,
        });
      } else {
        sendJson(res, { success: false, error: result.error || "Unknown error" }, 500);
      }
    } catch (err) {
      console.error("❌ Compare selected error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/delete") {
    try {
      const body = JSON.parse(await readBody(req)) as StoryScreenshotsPath;
      const { temp, diff, new: newPath, original } = body || {};

      const files = [original, temp, diff, newPath].filter(Boolean);

      if (!files.length) {
        throw new Error("Missing paths");
      }

      let movedAny = false;

      for (const p of files) {
        const absSource = join(PUBLIC_DIR, p!);
        if (!existsSync(absSource)) {
          // console.warn(`⚠️  File not found: ${absSource}`);
          continue;
        }

        // Retirer "Screenshots/" du début si présent pour éviter la duplication
        const cleanPath = p!.replace(/^Screenshots\//, "");
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

      refreshIndex(true);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Delete error:", err);
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
      const contentType = filePath.endsWith(".png")
        ? "image/png"
        : filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")
          ? "image/jpeg"
          : "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache", ...corsHeaders });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error("❌ Error serving file:", err);
      res.writeHead(500, corsHeaders);
      res.end("Internal Server Error");
    }
    return;
  }

  sendJson(res, { message: "Not Found" }, 404);
};

createServer(handler).listen(VR_SERVER_PORT, () => {
  console.log(`🟢 VR server started on ${VR_SERVER_URL}`);
  console.log(`📊 ${index.diffPaths.length} diffs, ${index.newPaths.length} nouveaux screenshots détectés`);
});
