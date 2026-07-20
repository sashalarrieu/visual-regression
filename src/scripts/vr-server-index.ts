// scripts/vr-server-index.ts (package @setshao/visual-regression)
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import { PNG } from "pngjs";

import {
  DIFF_SCREENSHOT_NAME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
  TREE_BASE_FOLDER,
  VR_SERVER_URL,
} from "../constants/constants";
import type { DeletedItem, Node, ParsedPath, RegressionIndex, StoryScreenshotsPath } from "../types/types";
import { getDevicesNames, getProjectPaths, getProjectRoot, resolveVrConfig } from "../utils/node";

const PROJECT_ROOT = getProjectRoot();
const { publicDir: PUBLIC_DIR, publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR } = getProjectPaths(PROJECT_ROOT);
const DEVICES = getDevicesNames(resolveVrConfig(PROJECT_ROOT).devices);
const join = path.join;

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
  // Chemins monorepo : Screenshots/packages/ui/src/... — ne pas tronquer au premier "src"
  // sinon les URLs perdent le préfixe packages/ui et renvoient 404.
  const cleanPath = normalized
    .replace(/^Screenshots\/deleted\//, "")
    .replace(/^deleted\//, "")
    .replace(/^Screenshots\//, "");

  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (!segments.includes(TREE_BASE_FOLDER)) return null;

  const fileName = segments[segments.length - 1];
  const folders = segments.slice(0, -1);

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
export const formatScreenshotLogLabel = (cleanPath: string): string => {
  const normalized = cleanPath.replace(/\\/g, "/").replace(/^Screenshots\//, "");
  const lastSlash = normalized.lastIndexOf("/");
  const componentDir = lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const { deviceName, storyId } = extractDeviceName(fileName);
  const screenshotKey = deviceName ? `${deviceName}-${storyId}` : storyId;
  return componentDir ? `${screenshotKey} | ${componentDir}` : screenshotKey;
};

/** Chemin préféré pour le libellé de log (original > diff > temp > new). */
export const pickScreenshotPathForLog = (paths: (string | undefined)[]): string | null => {
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
export const getDiffScreenshotVariants = (cleanPath: string): { diff: string; temp: string; original: string } => {
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
export const calculateImagePaths = (filePath: string): StoryScreenshotsPath => {
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
export const countRedPixelsInDiffImage = (diffImagePath: string): number | null => {
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
    path: "",
    children: {},
  };

  for (const file of files) {
    const parsedPath = parsePath(file);
    if (!parsedPath) continue;

    const { folders, fileName, label, deviceName } = parsedPath;

    let current = root;
    let currentPath = "";

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

  // Racine virtuelle → promouvoir l'unique enfant dossier (src/ en projet simple, packages/ en monorepo)
  const topLevel = Object.values(root.children ?? {});
  if (topLevel.length === 1 && topLevel[0].type === "folder") {
    return topLevel[0];
  }

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

export const buildIndexFromScan = (): RegressionIndex => {
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
