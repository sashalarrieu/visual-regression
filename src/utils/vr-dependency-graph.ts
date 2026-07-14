/**
 * Graphe de dépendances TurboSnap : preview-stats.json (Webpack) + fallback imports statiques.
 * Ne pas importer depuis l'app React/Expo (web).
 */
import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

import type { VrConfig } from "../types/types";

import { getPackageScriptCommand, spawnShellOption } from "./node";

export type StoryIndexEntryRef = {
  id: string;
  importPath: string;
};

export type DependencyGraph = {
  /** module normalisé → modules qui l'importent (remontée TurboSnap) */
  importers: Map<string, Set<string>>;
  modules: Set<string>;
  source: "preview-stats" | "static";
};

type WebpackStatsModule = {
  name?: string;
  id?: string;
  reasons?: {
    module?: string | null;
    resolvedModule?: string | null;
  }[];
};

type WebpackStats = {
  modules?: WebpackStatsModule[];
};

const STORIES_RE = /\.stories\.(tsx?|jsx?|mdx)$/i;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".css", ".scss"]);
const IMPORT_RE =
  /(?:import\s+(?:[\w*{}\s,$]+\s+from\s+)?|export\s+[\w*{}\s,$]+\s+from\s+|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

export const normalizeModulePath = (filePath: string): string => filePath.replace(/\\/g, "/").replace(/^\.\//, "");

const toModuleKey = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const normalized = normalizeModulePath(raw);
  if (!normalized || normalized.startsWith("external ")) return null;
  if (normalized.includes("node_modules")) return null;
  if (normalized.includes(" lazy ") || normalized.includes("namespace object")) return null;
  if (!/\.(tsx?|jsx?|cjs|mjs|css|scss|mdx)$/i.test(normalized)) return null;
  return normalized.startsWith("src/") || normalized.startsWith(".storybook/") ? normalized : null;
};

const isStoriesModule = (modulePath: string): boolean => STORIES_RE.test(modulePath);

/** Construit le graphe inverse à partir des modules Webpack (reasons = importeurs). */
export const buildImportersGraph = (statsModules: WebpackStatsModule[]): DependencyGraph => {
  const importers = new Map<string, Set<string>>();
  const modules = new Set<string>();

  const addImporter = (target: string, importer: string) => {
    if (target === importer) return;
    modules.add(target);
    modules.add(importer);
    let set = importers.get(target);
    if (!set) {
      set = new Set();
      importers.set(target, set);
    }
    set.add(importer);
  };

  for (const mod of statsModules) {
    const modulePath = toModuleKey(mod.name ?? mod.id);
    if (!modulePath) continue;
    modules.add(modulePath);

    for (const reason of mod.reasons ?? []) {
      const importer = toModuleKey(reason.resolvedModule ?? reason.module);
      if (importer) addImporter(modulePath, importer);
    }
  }

  return { importers, modules, source: "preview-stats" };
};

/** Charge preview-stats.json et retourne le graphe inverse. */
export const loadPreviewStats = (statsFilePath: string): DependencyGraph => {
  const raw = readFileSync(statsFilePath, "utf8");
  const stats = JSON.parse(raw) as WebpackStats;
  return buildImportersGraph(stats.modules ?? []);
};

const collectImportersUpward = (graph: DependencyGraph, startModules: string[]): Set<string> => {
  const visited = new Set<string>();
  const queue = [...startModules];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const importer of graph.importers.get(current) ?? []) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }

  return visited;
};

const mapStoriesModulesToStoryIds = (storyModules: Set<string>, storyIndex: StoryIndexEntryRef[]): Set<string> => {
  const byImportPath = new Map<string, string[]>();
  for (const story of storyIndex) {
    const key = normalizeModulePath(story.importPath);
    const ids = byImportPath.get(key) ?? [];
    ids.push(story.id);
    byImportPath.set(key, ids);
  }

  const storyIds = new Set<string>();
  for (const mod of storyModules) {
    if (!isStoriesModule(mod)) continue;
    for (const id of byImportPath.get(mod) ?? []) {
      storyIds.add(id);
    }
  }
  return storyIds;
};

const resolveChangedToModules = (changedFiles: string[], graph: DependencyGraph): string[] => {
  const resolved: string[] = [];
  for (const changed of changedFiles) {
    const normalized = normalizeModulePath(changed);
    if (graph.modules.has(normalized)) {
      resolved.push(normalized);
      continue;
    }
    // Fichier modifié absent du graphe (stats périmées ou non bundlé)
    for (const mod of graph.modules) {
      if (mod === normalized || mod.endsWith(`/${normalized}`)) {
        resolved.push(mod);
      }
    }
  }
  return [...new Set(resolved)];
};

/** Remonte le graphe Webpack depuis les fichiers modifiés → storyIds impactées. */
export const traceAffectedStories = (
  changedFiles: string[],
  graph: DependencyGraph,
  storyIndex: StoryIndexEntryRef[],
): Set<string> => {
  if (changedFiles.length === 0) return new Set();

  const startModules = resolveChangedToModules(changedFiles, graph);
  const reachable = collectImportersUpward(graph, startModules);

  // Fichier .stories modifié directement
  for (const changed of changedFiles) {
    const normalized = normalizeModulePath(changed);
    if (isStoriesModule(normalized)) reachable.add(normalized);
  }

  return mapStoriesModulesToStoryIds(reachable, storyIndex);
};

const resolveImportPath = (fromFile: string, specifier: string, projectRoot: string): string | null => {
  if (specifier.startsWith(".")) {
    const abs = path.resolve(projectRoot, path.dirname(fromFile), specifier);
    const candidates = [
      abs,
      `${abs}.ts`,
      `${abs}.tsx`,
      `${abs}.js`,
      `${abs}.jsx`,
      path.join(abs, "index.ts"),
      path.join(abs, "index.tsx"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return normalizeModulePath(path.relative(projectRoot, candidate));
      }
    }
  }
  return null;
};

const parseImports = (filePath: string, projectRoot: string): string[] => {
  const abs = path.join(projectRoot, filePath);
  if (!existsSync(abs)) return [];

  const content = readFileSync(abs, "utf8");
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const specifier = match[1];
    if (!specifier || (!specifier.startsWith(".") && !specifier.startsWith("@/"))) continue;
    const resolved = resolveImportPath(filePath, specifier.replace(/^@\//, "src/"), projectRoot);
    if (resolved) imports.push(resolved);
  }
  return imports;
};

/** Fallback : graphe via analyse récursive des imports TypeScript. */
export const buildStaticImportGraph = (projectRoot: string, roots = ["src", ".storybook"]): DependencyGraph => {
  const importers = new Map<string, Set<string>>();
  const modules = new Set<string>();

  const addImporter = (target: string, importer: string) => {
    modules.add(target);
    modules.add(importer);
    let set = importers.get(target);
    if (!set) {
      set = new Set();
      importers.set(target, set);
    }
    set.add(importer);
  };

  const walkDir = (absDir: string, relPrefix: string) => {
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "Screenshots") continue;
        walkDir(full, rel);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const filePath = normalizeModulePath(rel);
      modules.add(filePath);
      for (const imported of parseImports(filePath, projectRoot)) {
        addImporter(imported, filePath);
      }
    }
  };

  for (const root of roots) {
    walkDir(path.join(projectRoot, root), root);
  }

  return { importers, modules, source: "static" };
};

/** Fallback public : trace via imports statiques. */
export const traceViaStaticImports = (
  changedFiles: string[],
  storyIndex: StoryIndexEntryRef[],
  projectRoot: string,
): Set<string> => {
  console.warn("⚠️  preview-stats.json absent — fallback analyse statique des imports");
  const graph = buildStaticImportGraph(projectRoot);
  return traceAffectedStories(changedFiles, graph, storyIndex);
};

export type EnsurePreviewStatsOptions = {
  force?: boolean;
};

/**
 * Garantit la présence de preview-stats.json.
 * Rebuild Storybook (--stats-json) si absent ou force=true (global trigger).
 */
export const ensurePreviewStats = (
  projectRoot: string,
  config: VrConfig,
  options: EnsurePreviewStatsOptions = {},
): string => {
  const statsPath = path.join(projectRoot, config.compare.statsFile);

  if (!options.force && existsSync(statsPath)) {
    return statsPath;
  }

  console.log("\n📊 Génération preview-stats.json (storybook build --stats-json)…");
  const { command, args } = getPackageScriptCommand(projectRoot, "storybook:build:stats");
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, STORYBOOK_ENV: "web" },
    ...spawnShellOption,
  });
  if (result.status !== 0) {
    throw new Error(`storybook:build:stats a échoué (code ${result.status ?? 1})`);
  }

  if (!existsSync(statsPath)) {
    throw new Error(`preview-stats.json introuvable après build : ${config.compare.statsFile}`);
  }

  return statsPath;
};

export type ResolveAffectedStoryIdsOptions = {
  forceStatsRebuild?: boolean;
};

/**
 * Résout les storyIds impactées par les fichiers modifiés (TurboSnap).
 * Utilise preview-stats.json si disponible, sinon fallback statique.
 */
export const resolveAffectedStoryIds = (
  changedFiles: string[],
  storyIndex: StoryIndexEntryRef[],
  projectRoot: string,
  config: VrConfig,
  options: ResolveAffectedStoryIdsOptions = {},
): Set<string> => {
  if (changedFiles.length === 0) return new Set();

  const statsPath = path.join(projectRoot, config.compare.statsFile);

  try {
    const resolvedStatsPath = ensurePreviewStats(projectRoot, config, {
      force: options.forceStatsRebuild,
    });
    const graph = loadPreviewStats(resolvedStatsPath);
    const affected = traceAffectedStories(changedFiles, graph, storyIndex);

    // Complément naïf pour fichiers absents du graphe (stats périmées)
    for (const changed of changedFiles) {
      const normalized = normalizeModulePath(changed);
      const inGraph = graph.modules.has(normalized);
      if (!inGraph) {
        for (const story of storyIndex) {
          const importPath = normalizeModulePath(story.importPath);
          const componentDir = normalizeModulePath(path.dirname(importPath));
          if (normalized === importPath || normalized.startsWith(`${componentDir}/`)) {
            affected.add(story.id);
          }
        }
      }
    }

    if (affected.size > 0) {
      console.log(
        `🔗 TurboSnap (${graph.source}) : ${affected.size} story(s) impactée(s) sur ${changedFiles.length} fichier(s) modifié(s)`,
      );
    }

    return affected;
  } catch (err) {
    if (existsSync(statsPath)) {
      console.warn(`⚠️  Échec lecture preview-stats.json : ${err instanceof Error ? err.message : err}`);
    }
    return traceViaStaticImports(changedFiles, storyIndex, projectRoot);
  }
};
