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

import { PNG } from "pngjs";

import type { CacheData, DeletedItem, Node, ParsedPath, StoryScreenshotsPath } from "../types/types";
import {
  DIFF_SCREENSHOT_NAME,
  EXPO_PORT,
  LOCAL_URL,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
  TREE_BASE_FOLDER,
  VR_SERVER_PORT,
  VR_SERVER_URL,
} from "../constants/constants";
import {
  getDevicesDisplayConfig,
  getDevicesNames,
  getNodeTsxArgs,
  getProjectPaths,
  getProjectRoot,
  getScriptDir,
  loadVrDevicesConfig,
  spawnShellOption,
} from "../utils/node";

const PROJECT_ROOT = getProjectRoot();
const {
  publicDir: PUBLIC_DIR,
  publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR,
  deletedDir: DELETED_DIR,
} = getProjectPaths(PROJECT_ROOT);
const DEVICES = getDevicesNames(loadVrDevicesConfig(PROJECT_ROOT));
const SCRIPT_DIR = getScriptDir(import.meta);
const join = path.join;
const dirname = path.dirname;

// ============================================
// SYSTÈME DE CACHE DES RÉGRESSIONS
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

const createCache = (): CacheData => {
  return {
    diffPaths: [],
    newPaths: [],
    deletedPaths: [],
    lastUpdate: 0,
  };
};

const refreshCache = (_cache: CacheData, notify = true): CacheData => {
  // Scan optimisé : parcourt chaque répertoire une seule fois
  const { diffPaths, newPaths, deletedPaths } = scanAllScreenshots();

  const newCache = {
    diffPaths,
    newPaths,
    deletedPaths,
    lastUpdate: Date.now(),
  };

  console.log(
    `♻️  Cache rafraîchi: ${newCache.diffPaths.length} diffs, ${newCache.newPaths.length} nouveaux, ${newCache.deletedPaths.length} supprimés`,
  );

  // Notifier tous les clients SSE connectés
  if (notify && sseClients.size > 0) {
    notifyAllClients();
  }

  return newCache;
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
const getImageUrl = (path: string | undefined): string | undefined => {
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
    return `${VR_SERVER_URL}/${cleanPath}`;
  }

  // Pour les chemins de deleted qui commencent directement par "src/", on reconstruit
  if (cleanPath.startsWith("src/")) {
    // C'est un chemin depuis deleted/, on reconstruit
    return `${VR_SERVER_URL}/Screenshots/deleted/${cleanPath}`;
  }

  // S'assurer que le chemin commence par "Screenshots/" pour correspondre au serveur VR
  if (!cleanPath.startsWith("Screenshots/")) {
    cleanPath = `Screenshots/${cleanPath}`;
  }

  // Construire l'URL via le serveur VR normalement
  return `${VR_SERVER_URL}/${cleanPath}`;
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

const buildTree = (files: string[], baseDir: string): Node => {
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
        original: getImageUrl(imagePaths.original),
        temp: getImageUrl(imagePaths.temp),
        diff: getImageUrl(imagePaths.diff),
        new: getImageUrl(imagePaths.new),
      };

      // Calculer countPixelDiff pour les diff en comptant les pixels rouges dans l'image diff
      const countPixelDiff =
        isDiff && imagePaths.diff ? countRedPixelsInDiffImage(join(PUBLIC_DIR, imagePaths.diff)) : null;

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
        countPixelDiff,
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

  // Calculer countPixelDiff pour les diff en comptant les pixels rouges dans l'image diff
  const countPixelDiff = isDiff
    ? countRedPixelsInDiffImage(join(PUBLIC_DIR, SCREENSHOTS_DIR, "deleted", cleanPath))
    : null;

  return {
    ...parsed,
    isDiff,
    fullPath: cleanPath, // Juste "src/atoms/Alert/__diff__desktop-fhd-..." (pour la restauration)
    imagePath, // Chemin de l'image à afficher (__temp__ pour diff, __new__ pour new)
    imageUrl, // URL complète de l'image à afficher
    storyId,
    countPixelDiff,
  };
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
  const message = JSON.stringify({ type: "cache-updated", timestamp: Date.now() });
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
// SURVEILLANCE DU DOSSIER DELETED
// ============================================

let watchDebounceTimer: NodeJS.Timeout | null = null;
let ignoreWatchUntil: number = 0; // Timestamp jusqu'auquel ignorer les événements du watcher

/**
 * Ignore les événements du watcher pendant un court moment pour éviter les rafraîchissements en double
 */
const ignoreWatchTemporarily = (durationMs = 2000) => {
  ignoreWatchUntil = Date.now() + durationMs;
  // Annuler aussi le debounce en cours
  if (watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = null;
  }
};

const watchDeletedDirectory = () => {
  // Créer le dossier deleted s'il n'existe pas
  if (!existsSync(DELETED_DIR)) {
    mkdirSync(DELETED_DIR, { recursive: true });
  }

  // Fonction pour rafraîchir le cache avec debounce
  const debouncedRefresh = () => {
    // Ignorer si on est dans une période d'ignorance
    if (Date.now() < ignoreWatchUntil) {
      return;
    }

    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
    }
    watchDebounceTimer = setTimeout(() => {
      cache = refreshCache(cache, true);
      watchDebounceTimer = null;
    }, 1000); // Debounce de 1000ms pour éviter trop de rafraîchissements
  };

  // Surveiller récursivement le dossier deleted
  try {
    const watcher = watch(DELETED_DIR, { recursive: true }, (_, filename) => {
      if (!filename) return;

      // Le filename peut être relatif ou absolu selon l'OS
      const fullPath = filename.startsWith(DELETED_DIR) ? filename : join(DELETED_DIR, filename);
      const relativePath = fullPath.replace(PUBLIC_DIR, "");

      // Vérifier si c'est un fichier __diff__ ou __new__ dans le dossier deleted
      if (
        (relativePath.includes(DIFF_SCREENSHOT_NAME) || relativePath.includes(NEW_SCREENSHOT_NAME)) &&
        relativePath.includes("/deleted/") &&
        relativePath.endsWith(SCREENSHOT_EXTENSION)
      ) {
        debouncedRefresh();
      }
    });

    watcher.on("error", error => {
      const isEperm = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EPERM" || String(e).includes("EPERM");
      try {
        watcher.close();
      } catch {
        // ignore
      }
      // Aucun log pour EPERM : zéro bruit en console (Windows/antivirus)
      if (!isEperm(error)) {
        console.warn("⚠️  Erreur lors de la surveillance du dossier deleted:", error);
      }
    });

    return watcher;
  } catch (error) {
    const isEperm = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EPERM" || String(e).includes("EPERM");
    if (!isEperm(error)) {
      console.warn(`⚠️  Impossible de surveiller ${DELETED_DIR}:`, error);
    }
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
// INITIALISATION DU CACHE
// ============================================

// Restaurer tous les fichiers supprimés avant de scanner le cache
restoreAllDeletedFiles();

let cache = createCache();
console.log("🔄 Rafraîchissement du cache des régressions");
// Forcer le rafraîchissement du cache après la restauration (sans notifier car pas de clients connectés)
cache = refreshCache(cache, false);

// Démarrer la surveillance du dossier deleted
watchDeletedDirectory();

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

  if (req.method === "GET" && url.pathname === "/regressions") {
    try {
      sendJson(res, {
        diff: cache.diffPaths,
        new: cache.newPaths,
        deleted: cache.deletedPaths,
        lastUpdate: cache.lastUpdate,
      });
    } catch (err) {
      console.error("❌ Error fetching regressions:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/tree - Récupérer l'arborescence des régressions
  if (req.method === "GET" && url.pathname === "/regressions/tree") {
    try {
      const allPaths = [...cache.diffPaths, ...cache.newPaths];
      const rawTree = allPaths.length ? buildTree(allPaths, TREE_BASE_FOLDER) : null;
      const tree = rawTree ? sortTree(rawTree) : null;
      sendJson(res, { tree, lastUpdate: cache.lastUpdate });
    } catch (err) {
      console.error("❌ Error building tree:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  // 📖 GET /regressions/config/devices - Config d'affichage des devices (pour l'UI, depuis vr-devices.config.cjs)
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

  // 📖 GET /regressions/deleted - Récupérer les suppressions
  if (req.method === "GET" && url.pathname === "/regressions/deleted") {
    try {
      const deletedList = cache.deletedPaths
        .filter(p => p.includes(DIFF_SCREENSHOT_NAME) || p.includes(NEW_SCREENSHOT_NAME))
        .map(parseDeleted)
        .filter(Boolean) as DeletedItem[];
      sendJson(res, { deleted: deletedList, lastUpdate: cache.lastUpdate });
    } catch (err) {
      console.error("❌ Error fetching deleted:", err);
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
    res.write(`data: ${JSON.stringify({ type: "connected", clientId, lastUpdate: cache.lastUpdate })}\n\n`);

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
      cache = refreshCache(cache, true);

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
      const compareScript = path.join(SCRIPT_DIR, "compare-visual-regressions.ts");
      console.log("🔍 Lancement comparaison VR");
      const { command, args } = getNodeTsxArgs(compareScript);
      const compareProcess = spawn(command, args, {
        env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
        stdio: "inherit",
        ...spawnShellOption,
      });
      // Rafraîchir le cache après la comparaison et notifier les clients
      compareProcess.on("close", (code: number) => {
        console.log(`✅ Comparaison terminée (code: ${code})`);
        cache = refreshCache(cache, true);
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
      const body = JSON.parse(await readBody(req)) as { storyId: string; deviceName: string };
      const { storyId, deviceName } = body || {};
      if (!storyId || !deviceName) {
        sendJson(res, { success: false, error: "Missing storyId or deviceName" }, 400);
        return;
      }
      // Importer et appeler la fonction de comparaison pour une story spécifique
      const { compareSingleStory } = await import(path.join(SCRIPT_DIR, "compare-visual-regressions.ts"));
      const result = await compareSingleStory(storyId, deviceName);
      if (result.success) {
        // Rafraîchir le cache après la comparaison et notifier les clients
        cache = refreshCache(cache, true);
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
      const { compareByType } = await import(path.join(SCRIPT_DIR, "compare-visual-regressions.ts"));
      const result = await compareByType(type, deviceName);
      if (result.success) {
        // Rafraîchir le cache après la comparaison et notifier les clients
        cache = refreshCache(cache, true);
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
      // Importer et appeler la fonction de comparaison pour toutes les stories
      const { compareAllStories } = await import(path.join(SCRIPT_DIR, "compare-visual-regressions.ts"));
      const result = await compareAllStories(deviceName);
      if (result.success) {
        // Rafraîchir le cache après la comparaison et notifier les clients
        cache = refreshCache(cache, true);
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
      const body = JSON.parse(await readBody(req)) as { stories: { storyId: string; deviceName: string }[] };
      const { stories } = body || {};
      if (!Array.isArray(stories) || stories.length === 0) {
        sendJson(
          res,
          { success: false, error: "Missing or empty stories array (expected { storyId, deviceName }[])" },
          400,
        );
        return;
      }

      const { compareSelectedStories } = await import(path.join(SCRIPT_DIR, "compare-visual-regressions.ts"));
      const result = await compareSelectedStories(stories);
      if (result.success) {
        cache = refreshCache(cache, true);
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
        console.log(`🗃️  Moved to deleted/: ${cleanPath}`);
      }

      ignoreWatchTemporarily();
      cache = refreshCache(cache, true);
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
        // Pour un diff, restaurer les 3 fichiers: diff, temp, original
        // Le préfixe est maintenant au début, donc on le retire du début
        const basePath = cleanPath
          .replace(new RegExp(`^${DIFF_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "")
          .replace(new RegExp(`^${TEMP_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");

        const filesToRestore = [
          cleanPath, // Le fichier diff lui-même
          cleanPath.replace(
            new RegExp(`^${DIFF_SCREENSHOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
            TEMP_SCREENSHOT_NAME,
          ), // temp
          basePath, // original
        ];

        let restoredCount = 0;
        for (const file of filesToRestore) {
          const absDeleted = join(DELETED_DIR, file);
          const absRestore = join(PUBLIC_SCREENSHOTS_DIR, file);

          if (!existsSync(absDeleted)) {
            console.warn(`⚠️  Not in deleted/: ${file}`);
            continue;
          }

          mkdirSync(dirname(absRestore), { recursive: true });
          renameSync(absDeleted, absRestore);
          console.log(`↩️  Restored: ${file}`);
          restoredCount++;
        }

        if (restoredCount === 0) {
          sendJson(res, { success: false, error: "No files found in deleted/" }, 400);
          return;
        }
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
        console.log(`↩️  Restored: ${cleanPath}`);
      }

      ignoreWatchTemporarily();
      cache = refreshCache(cache, true);
      sendJson(res, { success: true });
    } catch (err) {
      console.error("❌ Restore error:", err);
      sendJson(res, { error: String(err) }, 500);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/refresh") {
    try {
      cache = refreshCache(cache, true);
      sendJson(res, {
        success: true,
        lastUpdate: cache.lastUpdate,
        diffCount: cache.diffPaths.length,
        newCount: cache.newPaths.length,
      });
    } catch (err) {
      console.error("❌ Refresh error:", err);
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
  console.log(`📊 ${cache.diffPaths.length} diffs, ${cache.newPaths.length} nouveaux screenshots détectés`);
});
