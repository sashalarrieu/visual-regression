/**
 * Catalogue Storybook × devices pour l'onglet « Toutes les stories ».
 * Construit à la volée depuis index.json (pas de cache durable).
 */
import { createHash } from "crypto";
import { existsSync, statSync } from "fs";
import path from "path";

import { FORCE_VR_TAG, IGNORE_VR_TAG, SCREENSHOT_NAME, SCREENSHOTS_DIR, VR_SERVER_URL } from "../constants/constants";
import type { Node, VRDeviceConfigItem } from "../types/types";

export type StorybookIndexEntry = {
  id: string;
  type?: string;
  importPath: string;
  title?: string;
  name?: string;
  tags?: string[];
};

export type StoriesCatalogResult = {
  tree: Node | null;
  fingerprint: string;
  storyCount: number;
};

const normalizeComponentDir = (dir: string): string => dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

export const isStoryIgnoredForVr = (tags: string[] | undefined): boolean => {
  const list = tags ?? [];
  return list.includes(IGNORE_VR_TAG) && !list.includes(FORCE_VR_TAG);
};

export const resolveBaselineScreenshotPath = (
  projectRoot: string,
  componentDir: string,
  deviceName: string,
  storyId: string,
): string => {
  const normalizedDir = normalizeComponentDir(componentDir);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
  return path.join(projectRoot, normalizedDir, SCREENSHOTS_DIR, baseName);
};

export const baselinePublicUrl = (
  componentDir: string,
  deviceName: string,
  storyId: string,
  version?: number,
): string => {
  const normalizedDir = normalizeComponentDir(componentDir);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
  const relative = `${normalizedDir}/${SCREENSHOTS_DIR}/${baseName}`.replace(/\\/g, "/");
  const base = `${VR_SERVER_URL}/baselines/${relative}`;
  return version !== undefined ? `${base}?v=${version}` : base;
};

const displayNameFromStoryId = (storyId: string): string =>
  storyId.includes("--") ? storyId.split("--").pop() || storyId : storyId;

const ensureFolder = (parent: Node, folderName: string, folderPath: string): Node => {
  if (!parent.children) parent.children = {};
  if (!parent.children[folderName]) {
    parent.children[folderName] = {
      type: "folder",
      name: folderName,
      path: folderPath,
      children: {},
    };
  }
  return parent.children[folderName];
};

const calculateCatalogCounts = (node: Node): void => {
  if (node.type === "file") return;

  let countBaseline = 0;
  let countMissing = 0;
  let countIgnored = 0;
  let countTotal = 0;

  for (const child of Object.values(node.children ?? {})) {
    if (child.type === "file") {
      countTotal++;
      if (child.ignored) countIgnored++;
      if (child.storyType === "baseline") countBaseline++;
      else if (child.storyType === "missing") countMissing++;
    } else {
      calculateCatalogCounts(child);
      countBaseline += child.countBaseline ?? 0;
      countMissing += child.countMissing ?? 0;
      countIgnored += child.countIgnored ?? 0;
      countTotal += child.countTotal ?? 0;
    }
  }

  node.countBaseline = countBaseline;
  node.countMissing = countMissing;
  node.countIgnored = countIgnored;
  node.countTotal = countTotal;
  // Réutilise les bullets TreePanel (new/diff) : baseline → primary, missing → danger
  node.countNew = countBaseline;
  node.countDiff = countMissing;
};

const promoteSingleRootFolder = (root: Node): Node | null => {
  const topLevel = Object.values(root.children ?? {});
  if (topLevel.length === 0) return null;
  if (topLevel.length === 1 && topLevel[0].type === "folder") return topLevel[0];
  return root;
};

/** Fingerprint stable : storyId|device|ignored|baseline (trié). */
export const computeCatalogFingerprint = (
  entries: { storyId: string; deviceName: string; ignored: boolean; hasBaseline: boolean }[],
): string => {
  const lines = entries
    .map(e => `${e.storyId}\t${e.deviceName}\t${e.ignored ? 1 : 0}\t${e.hasBaseline ? 1 : 0}`)
    .sort();
  return createHash("sha1").update(lines.join("\n")).digest("hex");
};

export const buildStoriesCatalogTree = (options: {
  projectRoot: string;
  stories: StorybookIndexEntry[];
  devices: VRDeviceConfigItem[];
}): StoriesCatalogResult => {
  const { projectRoot, stories, devices } = options;
  const fingerprintParts: {
    storyId: string;
    deviceName: string;
    ignored: boolean;
    hasBaseline: boolean;
  }[] = [];

  const root: Node = {
    type: "folder",
    name: "stories",
    path: "",
    children: {},
  };

  const storyEntries = stories.filter(s => s.type === "story" && !s.id.endsWith("--docs"));

  for (const story of storyEntries) {
    const storyId = story.id;
    const ignored = isStoryIgnoredForVr(story.tags);
    const componentDir = normalizeComponentDir(path.dirname(story.importPath));
    const folders = componentDir.split("/").filter(Boolean);
    const displayName = displayNameFromStoryId(storyId);

    let current = root;
    let currentPath = "";
    for (const folder of folders) {
      currentPath += `${folder}/`;
      current = ensureFolder(current, folder, currentPath);
    }

    for (const device of devices) {
      const deviceName = device.name;
      const baselineAbs = resolveBaselineScreenshotPath(projectRoot, componentDir, deviceName, storyId);
      const hasBaseline = existsSync(baselineAbs);
      let version: number | undefined;
      if (hasBaseline) {
        try {
          version = Math.floor(statSync(baselineAbs).mtimeMs);
        } catch {
          version = undefined;
        }
      }

      fingerprintParts.push({ storyId, deviceName, ignored, hasBaseline });

      const fileName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
      const filePath = `${componentDir}/${SCREENSHOTS_DIR}/${fileName}`.replace(/\\/g, "/");
      const label = `${deviceName} - ${storyId}`;

      if (!current.children) current.children = {};
      current.children[label] = {
        type: "file",
        name: label,
        path: filePath,
        storyType: hasBaseline ? "baseline" : "missing",
        ignored,
        deviceName,
        storyId,
        displayName,
        componentDir,
        imagePaths: hasBaseline ? { original: filePath } : undefined,
        imageUrls: hasBaseline
          ? { original: baselinePublicUrl(componentDir, deviceName, storyId, version) }
          : undefined,
      };
    }
  }

  calculateCatalogCounts(root);
  const tree = promoteSingleRootFolder(root);
  const fingerprint = computeCatalogFingerprint(fingerprintParts);

  return {
    tree,
    fingerprint,
    storyCount: storyEntries.length,
  };
};

/** Charge index.json Storybook et construit le catalogue. */
export const fetchAndBuildStoriesCatalog = async (options: {
  projectRoot: string;
  storybookUrl: string;
  devices: VRDeviceConfigItem[];
}): Promise<StoriesCatalogResult> => {
  const base = options.storybookUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/index.json`);
  if (!res.ok) {
    throw new Error(`Storybook index.json inaccessible (${res.status})`);
  }
  const data = (await res.json()) as { entries?: Record<string, StorybookIndexEntry> };
  const stories = Object.entries(data.entries ?? {}).map(([id, entry]) => ({
    ...entry,
    id: entry.id || id,
  }));
  return buildStoriesCatalogTree({
    projectRoot: options.projectRoot,
    stories,
    devices: options.devices,
  });
};

/**
 * Résout un chemin `/baselines/...` vers un fichier sous projectRoot.
 * Retourne null si traversal ou hors Screenshots.
 */
export const resolveBaselineServePath = (projectRoot: string, urlPathname: string): string | null => {
  const prefix = "/baselines/";
  if (!urlPathname.startsWith(prefix)) return null;
  const relative = decodeURIComponent(urlPathname.slice(prefix.length)).replace(/\\/g, "/");
  if (!relative || relative.includes("..") || relative.startsWith("/")) return null;
  if (!relative.includes(`/${SCREENSHOTS_DIR}/`) && !relative.startsWith(`${SCREENSHOTS_DIR}/`)) return null;
  const abs = path.resolve(projectRoot, relative);
  const rootResolved = path.resolve(projectRoot);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) return null;
  return abs;
};
