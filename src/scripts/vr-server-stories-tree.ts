// scripts/vr-server-stories-tree.ts — catalogue Storybook × devices pour GET /regressions/stories-tree
import { createHash } from "crypto";
import { existsSync } from "fs";
import path from "path";

import { FORCE_VR_TAG, IGNORE_VR_TAG, SCREENSHOT_NAME, SCREENSHOTS_DIR, VR_SERVER_URL } from "../constants/constants";
import type { Node, StoriesTreeResponse } from "../types/types";
import { getDevicesNames, getProjectPaths, getProjectRoot, getStorybookUrl, resolveVrConfig } from "../utils/node";

/** Entrée Storybook (index.json). */
export type StorybookIndexEntry = {
  id: string;
  type?: string;
  importPath?: string;
  title?: string;
  name?: string;
  tags?: string[];
};

export type BuildStoriesTreeInput = {
  entries: Record<string, StorybookIndexEntry>;
  deviceNames: string[];
  publicScreenshotsDir: string;
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

const isIgnoredStory = (tags: string[] | undefined): boolean => {
  const list = tags ?? [];
  return list.includes(IGNORE_VR_TAG) && !list.includes(FORCE_VR_TAG);
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
    const ignored = isIgnoredStory(story.tags);
    const displayName = displayNameFromStoryId(storyId);

    for (const deviceName of deviceNames) {
      const label = `${deviceName} - ${storyId}`;
      const baseName = `${deviceName}-${storyId}${SCREENSHOT_NAME}`;
      const absBaseline = resolvePublicBaselinePath(publicScreenshotsDir, componentDir, deviceName, storyId);
      const hasBaseline = baselineExists(absBaseline);
      const storyType = hasBaseline ? ("baseline" as const) : ("missing" as const);

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
      const relativeOriginal = `${componentDir}/${baseName}`;

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

      if (hasBaseline) {
        fileNode.imagePaths = { original: relativeOriginal };
        fileNode.imageUrls = { original: toImageUrl(relativeOriginal, vrServerUrl) };
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
 * Lit Storybook `index.json` à chaque appel et reconstruit le catalogue (pas de cache durable).
 */
export const buildStoriesTree = async (projectRoot = getProjectRoot()): Promise<StoriesTreeResponse> => {
  const config = resolveVrConfig(projectRoot);
  const { publicScreenshotsDir } = getProjectPaths(projectRoot);
  const deviceNames = getDevicesNames(config.devices);
  const storybookUrl = getStorybookUrl(projectRoot).replace(/\/$/, "");

  let entries: Record<string, StorybookIndexEntry> = {};
  try {
    const res = await fetch(`${storybookUrl}/index.json`);
    if (res.ok) {
      const data = (await res.json()) as { entries?: Record<string, StorybookIndexEntry> };
      entries = data.entries ?? {};
    } else {
      console.warn(`⚠️  stories-tree: index.json HTTP ${res.status} (${storybookUrl})`);
    }
  } catch (err) {
    console.warn(`⚠️  stories-tree: impossible de lire index.json (${storybookUrl}):`, err);
  }

  return buildStoriesTreeFromEntries({
    entries,
    deviceNames,
    publicScreenshotsDir,
  });
};
