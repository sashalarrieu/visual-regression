// scripts/vr-server-stories-tree.ts — catalogue Storybook × devices pour GET /regressions/stories-tree
import { createHash } from "crypto";
import { existsSync } from "fs";
import path from "path";

import { SCREENSHOT_NAME, SCREENSHOTS_DIR, VR_SERVER_URL } from "../constants/constants";
import type { Node, StoriesTreeResponse } from "../types/types";
import { getDevicesNames, getProjectPaths, getProjectRoot, getStorybookUrl, resolveVrConfig } from "../utils/node";
import { isIgnoredVrStory } from "../utils/vr-story-eligibility";
import { fetchStorybookIndexEntries, type StorybookIndexEntry } from "../utils/vr-storybook-index";

import {
  extractOrphanScreenshotMeta,
  scanScreenshotRelativePaths,
  scanSourceBaselineRelativePaths,
} from "./vr-server-orphans-tree";

export type { StorybookIndexEntry } from "../utils/vr-storybook-index";

export type BuildStoriesTreeInput = {
  entries: Record<string, StorybookIndexEntry>;
  deviceNames: string[];
  publicScreenshotsDir: string;
  /** Racine projet — permet de détecter les baselines source (`src/.../Screenshots/`). */
  projectRoot?: string;
  /** Override pour tests (défaut: existsSync). */
  baselineExists?: (absPath: string) => boolean;
  vrServerUrl?: string;
};

const normalizeComponentDir = (dir: string): string => dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/**
 * Chemin public baseline — même formule que `buildScreenshotPaths` (vr-capture-engine),
 * sans importer Playwright.
 */
export const resolvePublicBaselinePath = (
  publicScreenshotsDir: string,
  componentDir: string,
  deviceName: string,
  storyId: string,
): string => {
  const normalizedDir = normalizeComponentDir(componentDir);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
  return path.join(publicScreenshotsDir, normalizedDir, baseName);
};

/** Baseline source validée — `{componentDir}/Screenshots/{device}-{story}.screenshot.png`. */
export const resolveSourceBaselinePath = (
  projectRoot: string,
  componentDir: string,
  deviceName: string,
  storyId: string,
): string => {
  const normalizedDir = normalizeComponentDir(componentDir);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
  return path.join(projectRoot, normalizedDir, SCREENSHOTS_DIR, baseName);
};

type CatalogBaselineRef = {
  hasBaseline: boolean;
  imagePaths?: { original: string };
  imageUrls?: { original: string };
};

type CatalogBaselineIndex = {
  /** Clé `componentDir|device|storyId` → chemin relatif sous public/Screenshots/. */
  public: Map<string, string>;
  /** Clé `componentDir|device|storyId` → chemin relatif depuis la racine projet. */
  source: Map<string, string>;
};

const catalogBaselineKey = (componentDir: string, deviceName: string, storyId: string): string =>
  `${normalizeComponentDir(componentDir)}|${deviceName}|${storyId}`;

/** Index bulk des baselines disque (public + source) — même scan que l’onglet orphelins. */
export const buildCatalogBaselineIndex = (input: {
  projectRoot?: string;
  publicScreenshotsDir: string;
  deviceNames: string[];
}): CatalogBaselineIndex => {
  const { projectRoot, publicScreenshotsDir, deviceNames } = input;
  const publicMap = new Map<string, string>();
  const sourceMap = new Map<string, string>();

  for (const relativePath of scanScreenshotRelativePaths(publicScreenshotsDir)) {
    const meta = extractOrphanScreenshotMeta(path.basename(relativePath), deviceNames);
    if (!meta?.deviceName || meta.storyType !== "baseline") continue;
    const componentDir = normalizeComponentDir(path.dirname(relativePath));
    publicMap.set(catalogBaselineKey(componentDir, meta.deviceName, meta.storyId), relativePath);
  }

  if (projectRoot) {
    for (const relativePath of scanSourceBaselineRelativePaths(projectRoot)) {
      const meta = extractOrphanScreenshotMeta(path.basename(relativePath), deviceNames);
      if (!meta?.deviceName || meta.storyType !== "baseline") continue;
      const parts = relativePath.split("/");
      const screenshotsIdx = parts.lastIndexOf(SCREENSHOTS_DIR);
      if (screenshotsIdx <= 0) continue;
      const componentDir = parts.slice(0, screenshotsIdx).join("/");
      sourceMap.set(catalogBaselineKey(componentDir, meta.deviceName, meta.storyId), relativePath);
    }
  }

  return { public: publicMap, source: sourceMap };
};

/** Baseline catalogue : public/Screenshots d'abord, puis baseline source (post-validation). */
const resolveCatalogBaseline = (input: {
  publicScreenshotsDir: string;
  projectRoot?: string;
  componentDir: string;
  deviceName: string;
  storyId: string;
  vrServerUrl: string;
  baselineExists: (absPath: string) => boolean;
  baselineIndex?: CatalogBaselineIndex | null;
}): CatalogBaselineRef => {
  const {
    publicScreenshotsDir,
    projectRoot,
    componentDir,
    deviceName,
    storyId,
    vrServerUrl,
    baselineExists,
    baselineIndex,
  } = input;
  const normalizedDir = normalizeComponentDir(componentDir);
  const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
  const key = catalogBaselineKey(componentDir, deviceName, storyId);
  const vrBase = vrServerUrl.replace(/\/$/, "");

  if (baselineIndex) {
    const publicRel = baselineIndex.public.get(key);
    if (publicRel) {
      return {
        hasBaseline: true,
        imagePaths: { original: publicRel },
        imageUrls: { original: toImageUrl(publicRel, vrServerUrl) },
      };
    }

    const sourceRel = baselineIndex.source.get(key);
    if (sourceRel) {
      return {
        hasBaseline: true,
        imagePaths: { original: sourceRel },
        imageUrls: { original: `${vrBase}/project-file/${sourceRel}` },
      };
    }

    return { hasBaseline: false };
  }

  const publicAbs = resolvePublicBaselinePath(publicScreenshotsDir, componentDir, deviceName, storyId);
  if (baselineExists(publicAbs)) {
    const relativeOriginal = `${normalizedDir}/${baseName}`;
    return {
      hasBaseline: true,
      imagePaths: { original: relativeOriginal },
      imageUrls: { original: toImageUrl(relativeOriginal, vrServerUrl) },
    };
  }

  if (projectRoot) {
    const sourceAbs = resolveSourceBaselinePath(projectRoot, componentDir, deviceName, storyId);
    if (baselineExists(sourceAbs)) {
      const projectFileRel = `${normalizedDir}/${SCREENSHOTS_DIR}/${baseName}`;
      return {
        hasBaseline: true,
        imagePaths: { original: projectFileRel },
        imageUrls: { original: `${vrBase}/project-file/${projectFileRel}` },
      };
    }
  }

  return { hasBaseline: false };
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

const calculateCatalogCounts = (node: Node): void => {
  if (node.type === "file") return;

  let countBaseline = 0;
  let countMissing = 0;
  let countIgnored = 0;
  let countTotal = 0;

  if (node.children) {
    for (const child of Object.values(node.children)) {
      if (child.type === "file") {
        countTotal++;
        if (child.storyType === "baseline") countBaseline++;
        else if (child.storyType === "missing") countMissing++;
        if (child.ignored) countIgnored++;
      } else {
        calculateCatalogCounts(child);
        countBaseline += child.countBaseline || 0;
        countMissing += child.countMissing || 0;
        countIgnored += child.countIgnored || 0;
        countTotal += child.countTotal || 0;
      }
    }
  }

  node.countBaseline = countBaseline;
  node.countMissing = countMissing;
  node.countIgnored = countIgnored;
  node.countTotal = countTotal;
};

const sortTree = (node: Node): Node => {
  if (node.type === "file") return node;

  const sortedChildren: Record<string, Node> = {};
  const entries = Object.values(node.children ?? {}).sort((a, b) => {
    const storyCompare = getStoryIdForSort(a).localeCompare(getStoryIdForSort(b));
    if (storyCompare !== 0) return storyCompare;
    return getDeviceNameForSort(a).localeCompare(getDeviceNameForSort(b));
  });

  for (const child of entries) {
    sortedChildren[child.name] = sortTree(child);
  }

  return {
    ...node,
    children: sortedChildren,
    countBaseline: node.countBaseline,
    countMissing: node.countMissing,
    countIgnored: node.countIgnored,
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
  rows: { storyId: string; deviceName: string; ignored: boolean; storyType: "baseline" | "missing" }[],
): string => {
  const lines = rows.map(r => `${r.storyId}\t${r.deviceName}\t${r.ignored ? "1" : "0"}\t${r.storyType}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
};

const toImageUrl = (relativeUnderScreenshots: string, vrServerUrl: string): string => {
  const clean = relativeUnderScreenshots.replace(/\\/g, "/").replace(/^\/+/, "");
  const withPrefix = clean.startsWith(`${SCREENSHOTS_DIR}/`) ? clean : `${SCREENSHOTS_DIR}/${clean}`;
  return `${vrServerUrl.replace(/\/$/, "")}/${withPrefix}`;
};

/**
 * Construit l'arbre catalogue à partir d'entrées index.json déjà chargées (testable sans réseau).
 */
export const buildStoriesTreeFromEntries = (input: BuildStoriesTreeInput): StoriesTreeResponse => {
  const {
    entries,
    deviceNames,
    publicScreenshotsDir,
    projectRoot,
    baselineExists = existsSync,
    vrServerUrl = VR_SERVER_URL,
  } = input;

  const stories = Object.values(entries).filter(
    entry => entry.type === "story" && Boolean(entry.importPath) && !entry.id.endsWith("--docs"),
  );

  const root: Node = {
    type: "folder",
    name: "catalog",
    path: "",
    children: {},
  };

  const baselineIndex =
    baselineExists === existsSync
      ? buildCatalogBaselineIndex({ projectRoot, publicScreenshotsDir, deviceNames })
      : null;

  const fingerprintRows: {
    storyId: string;
    deviceName: string;
    ignored: boolean;
    storyType: "baseline" | "missing";
  }[] = [];

  for (const story of stories) {
    const storyId = story.id;
    const componentDir = normalizeComponentDir(path.dirname(story.importPath!));
    const folders = componentDir.split("/").filter(Boolean);
    const ignored = isIgnoredVrStory(story.tags);
    const displayName = displayNameFromStoryId(storyId);

    for (const deviceName of deviceNames) {
      const label = `${deviceName} - ${storyId}`;
      const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
      const baseline = resolveCatalogBaseline({
        publicScreenshotsDir,
        projectRoot,
        componentDir,
        deviceName,
        storyId,
        vrServerUrl,
        baselineExists,
        baselineIndex,
      });
      const storyType = baseline.hasBaseline ? ("baseline" as const) : ("missing" as const);

      fingerprintRows.push({ storyId, deviceName, ignored, storyType });

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

      if (current.children![label]) continue;

      const filePath = `${current.path}${baseName}`;

      const fileNode: Node = {
        type: "file",
        name: label,
        path: filePath,
        storyType,
        ignored,
        deviceName,
        storyId,
        displayName,
      };

      if (baseline.hasBaseline) {
        fileNode.imagePaths = baseline.imagePaths;
        fileNode.imageUrls = baseline.imageUrls;
      }

      current.children![label] = fileNode;
    }
  }

  if (Object.keys(root.children ?? {}).length === 0) {
    return {
      tree: null,
      fingerprint: buildFingerprint([]),
      storyCount: 0,
    };
  }

  calculateCatalogCounts(root);
  const tree = sortTree(promoteSingleRootFolder(root));

  return {
    tree,
    fingerprint: buildFingerprint(fingerprintRows),
    storyCount: stories.length,
  };
};

/**
 * Lit Storybook `index.json` (cache de repli si Storybook redémarre) et reconstruit le catalogue.
 */
export const buildStoriesTree = async (projectRoot = getProjectRoot()): Promise<StoriesTreeResponse> => {
  const config = resolveVrConfig(projectRoot);
  const { publicScreenshotsDir } = getProjectPaths(projectRoot);
  const deviceNames = getDevicesNames(config.devices);
  const storybookUrl = getStorybookUrl(projectRoot);
  const entries = await fetchStorybookIndexEntries(storybookUrl);

  return buildStoriesTreeFromEntries({
    entries,
    deviceNames,
    publicScreenshotsDir,
    projectRoot,
  });
};
