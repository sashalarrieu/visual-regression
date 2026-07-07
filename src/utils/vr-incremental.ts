/**
 * Mode incrémental VR : détection des fichiers modifiés, global triggers, filtrage des tâches.
 * Ne pas importer depuis l'app React/Expo (web).
 */
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { VrConfig, VrChangedFilesScope } from "@app-types/types";
import {
  DIFF_SCREENSHOT_NAME,
  FORCE_VR_TAG,
  NEW_SCREENSHOT_NAME,
  SCREENSHOT_NAME,
  SCREENSHOTS_DIR,
} from "@constants/constants";
import type { CaptureTask } from "@scripts/vr-capture-engine";
import { resolveAffectedStoryIds } from "@utils/vr-dependency-graph";

export type StoryIndexEntry = {
  id: string;
  importPath: string;
  type?: string;
  tags?: string[];
};

export type ChangedFilesResult = {
  files: string[];
  source: "git" | "manifest" | "none";
  /** true si pas de git ni manifest — le caller doit capturer toutes les tâches. */
  requiresFullRun?: boolean;
};

export type FilterCaptureTasksResult = {
  tasks: CaptureTask[];
  skipped: number;
  reason: "full" | "global-trigger" | "incremental" | "requires-full-run";
};

const normalizePath = (filePath: string): string => filePath.replace(/\\/g, "/").replace(/^\.\//, "");

const runGit = (projectRoot: string, args: string): string | null => {
  try {
    return execSync(`git ${args}`, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const isGitRepo = (projectRoot: string): boolean => runGit(projectRoot, "rev-parse --is-inside-work-tree") === "true";

const parseGitOutput = (output: string | null): string[] => {
  if (!output) return [];
  return output
    .split("\n")
    .map(line => normalizePath(line.trim()))
    .filter(Boolean);
};

/** Fichiers modifiés via git (base + working tree + untracked src/**). */
export const getChangedFilesFromGit = (
  projectRoot: string,
  config: VrConfig,
  scope: VrChangedFilesScope = config.compare.scope ?? "all",
): string[] => {
  const { compare } = config;
  const changed = new Set<string>();

  if (scope === "all" || scope === "branch") {
    for (const file of parseGitOutput(runGit(projectRoot, `diff --name-only ${compare.base}...HEAD`))) {
      changed.add(file);
    }
  }

  if (scope === "all" || scope === "working-tree") {
    if (compare.includeWorkingTree) {
      for (const file of parseGitOutput(runGit(projectRoot, "diff --name-only HEAD"))) {
        changed.add(file);
      }
      for (const file of parseGitOutput(runGit(projectRoot, "diff --name-only --cached"))) {
        changed.add(file);
      }
      for (const file of parseGitOutput(runGit(projectRoot, "ls-files --others --exclude-standard -- src/"))) {
        changed.add(file);
      }
    }
  }

  return [...changed];
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".css", ".scss"]);

const collectSourceFiles = (projectRoot: string): string[] => {
  const roots = ["src", ".storybook"];
  const files: string[] = [];

  const walk = (dir: string, relativePrefix: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "Screenshots") return;
        walk(full, rel);
        continue;
      }
      const ext = path.extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        files.push(normalizePath(rel));
      }
    }
  };

  for (const root of roots) {
    walk(path.join(projectRoot, root), root);
  }

  return files;
};

const hashFile = (absolutePath: string): string =>
  createHash("sha256").update(readFileSync(absolutePath)).digest("hex");

type ManifestFile = {
  version: number;
  updatedAt: string;
  files: Record<string, string>;
};

const loadManifest = (manifestPath: string): ManifestFile | null => {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestFile;
  } catch {
    return null;
  }
};

/** Fichiers modifiés via manifest hash (fallback sans git). */
export const getChangedFilesFromManifest = (projectRoot: string, config: VrConfig): ChangedFilesResult => {
  const manifestPath = path.join(projectRoot, config.compare.manifestPath);
  const manifest = loadManifest(manifestPath);

  if (!manifest) {
    console.warn(
      `⚠️  Git indisponible et manifest absent (${config.compare.manifestPath}) — capture complète pour ce run.`,
    );
    return { files: [], source: "none", requiresFullRun: true };
  }

  const changed: string[] = [];
  for (const rel of collectSourceFiles(projectRoot)) {
    const abs = path.join(projectRoot, rel);
    if (!existsSync(abs)) continue;
    const hash = hashFile(abs);
    if (manifest.files[rel] !== hash) {
      changed.push(rel);
    }
  }

  return { files: changed, source: "manifest" };
};

/** Combine git ou manifest. */
export const getChangedFiles = (
  projectRoot: string,
  config: VrConfig,
  options?: { scope?: VrChangedFilesScope },
): ChangedFilesResult => {
  const scope = options?.scope ?? config.compare.scope ?? "all";

  if (isGitRepo(projectRoot)) {
    const files = getChangedFilesFromGit(projectRoot, config, scope);
    return { files, source: "git" };
  }

  console.warn("⚠️  Dépôt git non détecté — fallback manifest hash.");
  return getChangedFilesFromManifest(projectRoot, config);
};

/** Persiste les hashes source après un run réussi. */
export const updateManifest = (projectRoot: string, config: VrConfig): void => {
  const manifestPath = path.join(projectRoot, config.compare.manifestPath);
  const files: Record<string, string> = {};

  for (const rel of collectSourceFiles(projectRoot)) {
    const abs = path.join(projectRoot, rel);
    if (!existsSync(abs)) continue;
    files[rel] = hashFile(abs);
  }

  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), files }, null, 2),
    "utf8",
  );
};

const globMatch = (filePath: string, pattern: string): boolean => {
  const file = normalizePath(filePath);
  const glob = normalizePath(pattern);

  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3);
    if (file === prefix || file.startsWith(`${prefix}/`)) return true;
  }

  const regexStr = glob
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");

  return new RegExp(`^${regexStr}$`).test(file);
};

/** Fichiers modifiés qui matchent un global trigger. */
export const getGlobalTriggerMatches = (changedFiles: string[], config: VrConfig): string[] =>
  changedFiles.filter(file => config.compare.globalTriggers.some(trigger => globMatch(file, trigger)));

/** Un fichier modifié matche un global trigger → run complet. */
export const isGlobalTrigger = (changedFiles: string[], config: VrConfig): boolean =>
  getGlobalTriggerMatches(changedFiles, config).length > 0;

const storyHasForceVrTag = (story: StoryIndexEntry): boolean => (story.tags ?? []).includes(FORCE_VR_TAG);

const hasBaseline = (projectRoot: string, task: CaptureTask): boolean => {
  const baselinePath = path.join(
    projectRoot,
    task.componentDir,
    SCREENSHOTS_DIR,
    `${task.deviceName}-${task.storyId}${SCREENSHOT_NAME}`,
  );
  return existsSync(baselinePath);
};

const hasPendingVrInPublic = (publicScreenshotsDir: string, task: CaptureTask): boolean => {
  const base = path.join(publicScreenshotsDir, task.componentDir);
  const newPath = path.join(base, `${NEW_SCREENSHOT_NAME}${task.deviceName}-${task.storyId}${SCREENSHOT_NAME}`);
  const diffPath = path.join(base, `${DIFF_SCREENSHOT_NAME}${task.deviceName}-${task.storyId}${SCREENSHOT_NAME}`);
  return existsSync(newPath) || existsSync(diffPath);
};

const storyById = (stories: StoryIndexEntry[]): Map<string, StoryIndexEntry> => new Map(stories.map(s => [s.id, s]));

/**
 * Filtre les tâches de capture (mode incrémental + TurboSnap via preview-stats.json).
 */
export const filterCaptureTasks = (
  allTasks: CaptureTask[],
  config: VrConfig,
  stories: StoryIndexEntry[],
  options: {
    projectRoot: string;
    publicScreenshotsDir: string;
    changedFiles: ChangedFilesResult;
    /** Force rebuild preview-stats.json (ex. après global trigger). */
    forceStatsRebuild?: boolean;
  },
): FilterCaptureTasksResult => {
  if (config.compare.mode === "full") {
    return { tasks: allTasks, skipped: 0, reason: "full" };
  }

  if (options.changedFiles.requiresFullRun) {
    return { tasks: allTasks, skipped: 0, reason: "requires-full-run" };
  }

  if (isGlobalTrigger(options.changedFiles.files, config)) {
    const triggers = config.compare.globalTriggers.filter(t => options.changedFiles.files.some(f => globMatch(f, t)));
    console.log(`\n🌐 Global trigger détecté (${triggers.join(", ")}) — capture complète`);
    return { tasks: allTasks, skipped: 0, reason: "global-trigger" };
  }

  const affectedStoryIds = resolveAffectedStoryIds(options.changedFiles.files, stories, options.projectRoot, config, {
    forceStatsRebuild: options.forceStatsRebuild,
  });

  const index = storyById(stories);
  const filtered: CaptureTask[] = [];
  let skipped = 0;

  for (const task of allTasks) {
    const story = index.get(task.storyId);
    if (!story) {
      filtered.push(task);
      continue;
    }

    if (storyHasForceVrTag(story)) {
      filtered.push(task);
      continue;
    }

    if (!hasBaseline(options.projectRoot, task)) {
      filtered.push(task);
      continue;
    }

    if (hasPendingVrInPublic(options.publicScreenshotsDir, task)) {
      filtered.push(task);
      continue;
    }

    if (affectedStoryIds.has(task.storyId)) {
      filtered.push(task);
      continue;
    }

    skipped++;
  }

  if (skipped > 0) {
    console.log(`⏭️  ${skipped} tâche(s) ignorée(s) (unchanged)`);
  }

  return { tasks: filtered, skipped, reason: "incremental" };
};

/** Wipe public/Screenshots/ si mode full ou global trigger. */
export const shouldWipePublicDir = (config: VrConfig, filterResult: FilterCaptureTasksResult): boolean => {
  if (config.compare.mode === "full") return true;
  return filterResult.reason === "global-trigger";
};
