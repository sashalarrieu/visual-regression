// scripts/vr-server-orphans-tree.ts — screenshots disque sans story Storybook pour GET /regressions/orphans-tree
import { createHash } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";

import {
  DIFF_SCREENSHOT_NAME,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_EXTENSION,
  SCREENSHOT_NAME,
  SCREENSHOTS_DIR,
  TEMP_SCREENSHOT_NAME,
  TREE_BASE_FOLDER,
  VR_SERVER_URL,
} from "../constants/constants";
import type { Node, OrphansTreeResponse, StoryScreenshotsPath } from "../types/types";
import { getDevicesNames, getProjectPaths, getProjectRoot, getStorybookUrl, resolveVrConfig } from "../utils/node";
import { compareNodeTypeForDisplay } from "../utils/tree-order";
import { fetchStorybookIndexEntries } from "../utils/vr-storybook-index";

import type { StorybookIndexEntry } from "./vr-server-stories-tree";

/** Finder macOS : « foo.screenshot copy.png » au lieu de « foo.screenshot.png ». */
const FINDER_SCREENSHOT_COPY_RE = /\.screenshot copy\.png$/i;

/** Normalise le nom fichier pour le parsing device/storyId. */
export const canonicalizeScreenshotFileName = (fileName: string): string =>
  fileName.replace(FINDER_SCREENSHOT_COPY_RE, SCREENSHOT_NAME);

/** Candidat orphelin source : `*.screenshot.png` (+ variante Finder « copy »). */
export const isOrphanScreenshotCandidate = (fileName: string): boolean => {
  const canonical = canonicalizeScreenshotFileName(fileName);
  if (!canonical.endsWith(SCREENSHOT_NAME)) return false;
  if (canonical.startsWith(TEMP_SCREENSHOT_NAME)) return false;
  if (canonical.startsWith(DIFF_SCREENSHOT_NAME)) return false;
  if (canonical.startsWith(NEW_SCREENSHOT_NAME)) return false;
  return true;
};
/** Origine d’un fichier orphelin : working copy public vs baseline co-localisée. */
export type OrphanScanOrigin = "public" | "source";

export type OrphanScanEntry = {
  /**
   * public → relatif sous `public/Screenshots/` (ex. `src/demo/.../file.screenshot.png`)
   * source → relatif au project root (ex. `src/demo/.../Screenshots/file.screenshot.png`)
   */
  relativePath: string;
  origin: OrphanScanOrigin;
};

export type BuildOrphansTreeInput = {
  /** @deprecated Preférer `entries`. Chemins publics relatifs sous Screenshots/. */
  relativePaths?: string[];
  entries?: OrphanScanEntry[];
  knownStoryIds: Set<string>;
  deviceNames: string[];
  vrServerUrl?: string;
};

const SOURCE_SCAN_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".yarn",
  "dist",
  "build",
  "coverage",
  "storybook-static",
  "public",
  ".next",
  ".expo",
  "android",
  "ios",
]);

export type ExtractedScreenshotName = {
  deviceName: string | null;
  storyId: string;
  storyType: "new" | "diff" | "baseline";
};

/**
 * Extrait device + storyId + type — même logique que `extractDeviceName` (vr-server-index),
 * avec devices injectés (testable) et détection baseline / new / diff.
 */
export const extractOrphanScreenshotMeta = (
  fileName: string,
  deviceNames: string[],
): ExtractedScreenshotName | null => {
  const canonical = canonicalizeScreenshotFileName(fileName);
  if (!canonical.endsWith(SCREENSHOT_NAME)) return null;
  if (canonical.startsWith(TEMP_SCREENSHOT_NAME)) return null;

  let storyType: ExtractedScreenshotName["storyType"] = "baseline";
  let cleanFileName = canonical;

  if (cleanFileName.startsWith(DIFF_SCREENSHOT_NAME)) {
    storyType = "diff";
    cleanFileName = cleanFileName.slice(DIFF_SCREENSHOT_NAME.length);
  } else if (cleanFileName.startsWith(NEW_SCREENSHOT_NAME)) {
    storyType = "new";
    cleanFileName = cleanFileName.slice(NEW_SCREENSHOT_NAME.length);
  }

  for (const deviceName of deviceNames) {
    if (cleanFileName.startsWith(`${deviceName}-`)) {
      const storyId = cleanFileName.replace(`${deviceName}-`, "").replace(SCREENSHOT_NAME, "");
      return { deviceName, storyId, storyType };
    }
  }

  const storyId = cleanFileName.replace(SCREENSHOT_NAME, "");
  return { deviceName: null, storyId, storyType };
};

const displayNameFromStoryId = (storyId: string): string =>
  storyId.includes("--") ? storyId.split("--").pop() || storyId : storyId;

const getStoryIdForSort = (node: Node): string => {
  if (node.name.includes(" - ")) return node.name.split(" - ")[1];
  return node.name;
};

const getDeviceNameForSort = (node: Node): string => {
  if (node.name.includes(" - ")) return node.name.split(" - ")[0];
  return "";
};

const calculateOrphanCounts = (node: Node): void => {
  if (node.type === "file") return;

  let countDiff = 0;
  let countNew = 0;
  let countBaseline = 0;
  let countTotal = 0;

  if (node.children) {
    for (const child of Object.values(node.children)) {
      if (child.type === "file") {
        countTotal++;
        if (child.storyType === "diff") countDiff++;
        else if (child.storyType === "new") countNew++;
        else if (child.storyType === "baseline") countBaseline++;
      } else {
        calculateOrphanCounts(child);
        countDiff += child.countDiff || 0;
        countNew += child.countNew || 0;
        countBaseline += child.countBaseline || 0;
        countTotal += child.countTotal || 0;
      }
    }
  }

  node.countDiff = countDiff;
  node.countNew = countNew;
  node.countBaseline = countBaseline;
  node.countTotal = countTotal;
};

const sortTree = (node: Node): Node => {
  if (node.type === "file") return node;

  const sortedChildren: Record<string, Node> = {};
  const entries = Object.entries(node.children ?? {}).sort(([, a], [, b]) => {
    const typeCompare = compareNodeTypeForDisplay(a, b);
    if (typeCompare !== 0) return typeCompare;
    const storyCompare = getStoryIdForSort(a).localeCompare(getStoryIdForSort(b));
    if (storyCompare !== 0) return storyCompare;
    const deviceCompare = getDeviceNameForSort(a).localeCompare(getDeviceNameForSort(b));
    if (deviceCompare !== 0) return deviceCompare;
    return a.path.localeCompare(b.path);
  });

  for (const [key, child] of entries) {
    sortedChildren[key] = sortTree(child);
  }

  return {
    ...node,
    children: sortedChildren,
    countDiff: node.countDiff,
    countNew: node.countNew,
    countBaseline: node.countBaseline,
    countTotal: node.countTotal,
  };
};

const promoteSingleRootFolder = (root: Node): Node => {
  const topLevel = Object.values(root.children ?? {});
  if (topLevel.length === 1 && topLevel[0].type === "folder") {
    return topLevel[0];
  }
  return root;
};

const buildFingerprint = (
  rows: { relativePath: string; storyId: string; deviceName: string; storyType: string }[],
): string => {
  const lines = rows.map(r => `${r.relativePath}\t${r.storyId}\t${r.deviceName}\t${r.storyType}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
};

const toPublicImageUrl = (relativeUnderScreenshots: string, vrServerUrl: string): string => {
  const clean = relativeUnderScreenshots.replace(/\\/g, "/").replace(/^\/+/, "");
  const withPrefix = clean.startsWith(`${SCREENSHOTS_DIR}/`) ? clean : `${SCREENSHOTS_DIR}/${clean}`;
  return `${vrServerUrl.replace(/\/$/, "")}/${withPrefix}`;
};

/** Sert les baselines co-localisées via GET /project-file/<path-from-root>. */
export const toSourceImageUrl = (projectRelativePath: string, vrServerUrl: string): string => {
  const clean = projectRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${vrServerUrl.replace(/\/$/, "")}/project-file/${clean}`;
};

const buildPublicImagePaths = (
  relativePath: string,
  storyType: ExtractedScreenshotName["storyType"],
): StoryScreenshotsPath => {
  const underScreenshots = `${SCREENSHOTS_DIR}/${relativePath.replace(/\\/g, "/")}`;
  if (storyType === "diff") {
    const pathParts = underScreenshots.split("/");
    const fileName = pathParts[pathParts.length - 1];
    const dirPath = pathParts.slice(0, -1).join("/");
    const baseName = fileName.startsWith(DIFF_SCREENSHOT_NAME) ? fileName.slice(DIFF_SCREENSHOT_NAME.length) : fileName;
    return {
      original: `${dirPath}/${baseName}`,
      temp: `${dirPath}/${TEMP_SCREENSHOT_NAME}${baseName}`,
      diff: underScreenshots,
    };
  }
  if (storyType === "new") {
    return { new: underScreenshots };
  }
  return { original: underScreenshots };
};

const buildSourceImagePaths = (
  projectRelativePath: string,
  storyType: ExtractedScreenshotName["storyType"],
): StoryScreenshotsPath => {
  const clean = projectRelativePath.replace(/\\/g, "/");
  // Les baselines source n’ont en pratique que `original` ; new/diff restent supportés si présents.
  if (storyType === "new") return { new: clean };
  if (storyType === "diff") return { diff: clean, original: clean };
  return { original: clean };
};

const normalizeScanEntries = (input: BuildOrphansTreeInput): OrphanScanEntry[] => {
  if (input.entries?.length) return input.entries;
  return (input.relativePaths ?? []).map(relativePath => ({
    relativePath,
    origin: "public" as const,
  }));
};

const parseRelativeScreenshotPath = (
  relativePath: string,
  deviceNames: string[],
): {
  folders: string[];
  fileName: string;
  label: string;
  meta: ExtractedScreenshotName;
} | null => {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("/deleted/") || normalized.startsWith("deleted/")) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (!segments.includes(TREE_BASE_FOLDER)) return null;

  const fileName = segments[segments.length - 1];
  const folders = segments.slice(0, -1);
  const meta = extractOrphanScreenshotMeta(fileName, deviceNames);
  if (!meta) return null;

  const label = meta.deviceName ? `${meta.deviceName} - ${meta.storyId}` : meta.storyId;
  return { folders, fileName, label, meta };
};

/**
 * Construit l'arbre des orphelins à partir de chemins déjà scannés (testable sans FS / réseau).
 */
export const buildOrphansTreeFromScan = (input: BuildOrphansTreeInput): OrphansTreeResponse => {
  const { knownStoryIds, deviceNames, vrServerUrl = VR_SERVER_URL } = input;
  const entries = normalizeScanEntries(input);

  const root: Node = {
    type: "folder",
    name: "orphans",
    path: "",
    children: {},
  };

  const fingerprintRows: {
    relativePath: string;
    storyId: string;
    deviceName: string;
    storyType: string;
  }[] = [];

  /** Dédoupe public + source pour le même device/story/type. */
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const parsed = parseRelativeScreenshotPath(entry.relativePath, deviceNames);
    if (!parsed) continue;

    const { folders, fileName, label, meta } = parsed;
    if (knownStoryIds.has(meta.storyId)) continue;

    const dedupeKey = `${meta.deviceName ?? ""}|${meta.storyId}|${meta.storyType}|${fileName}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const normalizedRel = entry.relativePath.replace(/\\/g, "/");
    fingerprintRows.push({
      relativePath: `${entry.origin}:${normalizedRel}`,
      storyId: meta.storyId,
      deviceName: meta.deviceName ?? "",
      storyType: meta.storyType,
    });

    let current = root;
    let currentPath = "";
    for (const folder of folders) {
      currentPath += `${folder}/`;
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

    // Clé = fileName pour conserver baseline + __new__/__diff__ du même storyId orphelin
    if (current.children![fileName]) continue;

    const filePath = `${current.path}${fileName}`;
    const imagePaths =
      entry.origin === "source"
        ? buildSourceImagePaths(normalizedRel, meta.storyType)
        : buildPublicImagePaths(normalizedRel, meta.storyType);

    const toUrl = (p: string | undefined): string | undefined => {
      if (!p) return undefined;
      if (entry.origin === "source") return toSourceImageUrl(p, vrServerUrl);
      return toPublicImageUrl(p.replace(/^Screenshots\//, ""), vrServerUrl);
    };

    const imageUrls: StoryScreenshotsPath = {
      original: toUrl(imagePaths.original),
      temp: toUrl(imagePaths.temp),
      diff: toUrl(imagePaths.diff),
      new: toUrl(imagePaths.new),
    };

    current.children![fileName] = {
      type: "file",
      name: label,
      path: filePath,
      storyType: meta.storyType,
      deviceName: meta.deviceName ?? undefined,
      storyId: meta.storyId,
      displayName: displayNameFromStoryId(meta.storyId),
      imagePaths,
      imageUrls,
    };
  }

  const countTotal = fingerprintRows.length;
  if (countTotal === 0) {
    return {
      tree: null,
      fingerprint: buildFingerprint([]),
      countTotal: 0,
    };
  }

  calculateOrphanCounts(root);
  const tree = sortTree(promoteSingleRootFolder(root));

  return {
    tree,
    fingerprint: buildFingerprint(fingerprintRows),
    countTotal,
  };
};

/** StoryIds Storybook (type story) — référence pour détecter les orphelins. */
export const collectKnownStoryIds = (entries: Record<string, StorybookIndexEntry>): Set<string> => {
  const ids = new Set<string>();
  for (const entry of Object.values(entries)) {
    if (entry.type === "story" && entry.id && !entry.id.endsWith("--docs")) {
      ids.add(entry.id);
    }
  }
  return ids;
};

/**
 * Scan récursif de public/Screenshots (exclut deleted/ et __temp__).
 * Retourne des chemins relatifs sous Screenshots/.
 */
export const scanScreenshotRelativePaths = (publicScreenshotsDir: string): string[] => {
  const results: string[] = [];
  if (!existsSync(publicScreenshotsDir)) return results;

  const walk = (currentDir: string) => {
    let files: string[];
    try {
      files = readdirSync(currentDir);
    } catch (err) {
      console.warn(`⚠️  orphans-tree: erreur scan ${currentDir}:`, err);
      return;
    }

    for (const file of files) {
      if (file === "deleted" || file === "validated") continue;
      const fullPath = path.join(currentDir, file);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!file.endsWith(SCREENSHOT_EXTENSION)) continue;
      if (file.startsWith(TEMP_SCREENSHOT_NAME)) continue;

      const relative = path.relative(publicScreenshotsDir, fullPath).replace(/\\/g, "/");
      if (relative.includes("/deleted/") || relative.startsWith("deleted/")) continue;
      results.push(relative);
    }
  };

  walk(publicScreenshotsDir);
  return results;
};

/**
 * Scan de tout `*.screenshot.png` sous le project root (pas seulement `…/Screenshots/`).
 * Inclut les variantes Finder « .screenshot copy.png » et les fichiers hors dossier Screenshots.
 */
export const scanSourceBaselineRelativePaths = (projectRoot: string): string[] => {
  const results: string[] = [];
  if (!existsSync(projectRoot)) return results;

  const walk = (currentDir: string) => {
    let files: string[];
    try {
      files = readdirSync(currentDir);
    } catch (err) {
      console.warn(`⚠️  orphans-tree: erreur scan source ${currentDir}:`, err);
      return;
    }

    for (const file of files) {
      if (SOURCE_SCAN_SKIP_DIRS.has(file)) continue;
      const fullPath = path.join(currentDir, file);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!isOrphanScreenshotCandidate(file)) continue;

      const relative = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
      if (!relative || relative.startsWith("..")) continue;
      // Même contrainte d’arbre que parseRelativeScreenshotPath (présence de TREE_BASE_FOLDER).
      if (!relative.split("/").includes(TREE_BASE_FOLDER)) continue;
      results.push(relative);
    }
  };

  walk(projectRoot);
  return results;
};

/**
 * Lit index.json (cache de repli) + scan disque (public + source) à chaque appel.
 */
export const buildOrphansTree = async (projectRoot = getProjectRoot()): Promise<OrphansTreeResponse> => {
  const config = resolveVrConfig(projectRoot);
  const { publicScreenshotsDir } = getProjectPaths(projectRoot);
  const deviceNames = getDevicesNames(config.devices);
  const storybookUrl = getStorybookUrl(projectRoot);
  const entries = await fetchStorybookIndexEntries(storybookUrl);

  const publicEntries: OrphanScanEntry[] = scanScreenshotRelativePaths(publicScreenshotsDir).map(relativePath => ({
    relativePath,
    origin: "public",
  }));
  const sourceEntries: OrphanScanEntry[] = scanSourceBaselineRelativePaths(projectRoot).map(relativePath => ({
    relativePath,
    origin: "source",
  }));

  return buildOrphansTreeFromScan({
    // Source d’abord : si le même orphelin existe aussi en public, on garde la baseline source.
    entries: [...sourceEntries, ...publicEntries],
    knownStoryIds: collectKnownStoryIds(entries),
    deviceNames,
  });
};
