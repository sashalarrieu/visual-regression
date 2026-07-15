/**
 * Lancement de Storybook pour la capture VR (dev HMR ou statique).
 * Utilisé par le daemon de capture (sidecar Docker) et réutilisable par le launcher.
 *
 * - mode "dev"    : `storybook dev` (HMR — les changements de stories/composants
 *   sont pris en compte sans rebuild). Recommandé en session locale.
 * - mode "static" : build `storybook-static` (+ stats) puis `serve`. Recommandé en CI
 *   (build unique, plus déterministe).
 */
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import { getPackageScriptCommand, getProjectRoot, spawnShellOption, waitForStorybookStories } from "./node";
import { resolveVrConfig } from "./vr-config";

export type StorybookMode = "dev" | "static";

/** Projet consommateur basé sur @storybook/nextjs-vite (Next.js + Vite). */
export const usesNextJsViteStorybook = (projectRoot: string): boolean => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Boolean(deps["@storybook/nextjs-vite"]);
  } catch {
    return false;
  }
};

/**
 * Mode Storybook pour la capture (daemon Docker ou scripts).
 * En Docker + nextjs-vite : statique par défaut (le dev Vite ne rend pas les stories en headless).
 */
export const resolveStorybookModeForCapture = (projectRoot: string): StorybookMode => {
  const envMode = (process.env.VR_STORYBOOK_MODE || "").toLowerCase();
  if (envMode === "static" || envMode === "dev") {
    return envMode === "static" ? "static" : "dev";
  }
  if (process.env.VR_STORYBOOK_STATIC === "1") return "static";

  const config = resolveVrConfig(projectRoot);
  if (config.launcher.storybookMode === "static" || config.launcher.storybookMode === "dev") {
    return config.launcher.storybookMode;
  }

  if (process.env.VR_DOCKER === "1" && usesNextJsViteStorybook(projectRoot)) {
    return "static";
  }

  return "dev";
};

/** Mode Storybook résolu (env > vr.config > auto). */
export const getStorybookMode = (): StorybookMode => {
  const envMode = (process.env.VR_STORYBOOK_MODE || "").toLowerCase();
  if (envMode === "static" || envMode === "dev") {
    return envMode === "static" ? "static" : "dev";
  }
  if (process.env.VR_STORYBOOK_STATIC === "1") return "static";
  if (process.env.VR_DOCKER === "1") {
    return resolveStorybookModeForCapture(getProjectRoot());
  }
  try {
    const config = resolveVrConfig(getProjectRoot());
    if (config.launcher.storybookMode === "static" || config.launcher.storybookMode === "dev") {
      return config.launcher.storybookMode;
    }
  } catch {
    // pas de vr.config (tests internes)
  }
  return "dev";
};

/**
 * Ajoute node_modules/.bin du projet au PATH.
 * Nécessaire quand on spawn des binaires locaux (storybook, cross-env, serve)
 * hors du contexte yarn/npm — notamment dans le conteneur où le daemon est lancé
 * directement (le PATH n'inclut pas node_modules/.bin).
 */
const withLocalBinPath = (projectRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const binDir = path.join(projectRoot, "node_modules", ".bin");
  const sep = process.platform === "win32" ? ";" : ":";
  const currentPath = env.PATH ?? process.env.PATH ?? "";
  return { ...env, PATH: `${binDir}${sep}${currentPath}` };
};

const STORYBOOK_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".css", ".scss", ".mdx"]);

/** mtime le plus récent parmi src/ et .storybook/ (inputs du build Storybook). */
export const getNewestStorybookInputMtime = (projectRoot: string): number => {
  const roots = ["src", ".storybook"];
  let newest = 0;

  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "Screenshots") continue;
        walk(full);
        continue;
      }
      if (!STORYBOOK_SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      try {
        const mtime = statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        // ignore fichiers supprimés pendant le walk
      }
    }
  };

  for (const root of roots) {
    walk(path.join(projectRoot, root));
  }
  return newest;
};

/** true si un build statique de Storybook est nécessaire (absent, stats manquantes ou sources plus récentes). */
export const needsStaticStorybookBuild = (projectRoot: string, statsRelativePath: string): boolean => {
  if (process.env.VR_STORYBOOK_STATIC_REBUILD === "1") return true;
  try {
    if (resolveVrConfig(projectRoot).launcher.forceStaticRebuild) return true;
  } catch {
    // ignore
  }
  const staticIndex = path.join(projectRoot, "storybook-static", "index.html");
  const statsPath = path.join(projectRoot, statsRelativePath);
  const missingBuild = !existsSync(staticIndex) || !existsSync(statsPath);
  const buildMtime = missingBuild ? 0 : statSync(staticIndex).mtimeMs;
  const sourceMtime = getNewestStorybookInputMtime(projectRoot);
  const stale = !missingBuild && sourceMtime > buildMtime;
  const needsBuild = missingBuild || stale;

  return needsBuild;
};

/** Build Storybook statique (--stats-json). Résout avec le code de sortie. */
export const buildStaticStorybook = (projectRoot: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const { command, args } = getPackageScriptCommand(projectRoot, "storybook:build:stats");
    const proc = spawn(command, args, {
      stdio: "inherit",
      cwd: projectRoot,
      env: withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" }),
      ...spawnShellOption,
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

/** Démarre `serve storybook-static` sur le port donné. */
export const startStaticStorybookServer = (projectRoot: string, port: number): ChildProcess => {
  const listenArg = process.env.VR_DOCKER === "1" ? `tcp://0.0.0.0:${port}` : String(port);
  return spawn("npx", ["serve", "storybook-static", "-l", listenArg], {
    stdio: "inherit",
    shell: true,
    cwd: projectRoot,
    env: withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" }),
  });
};

/**
 * Force le watching par polling dans le conteneur Docker.
 *
 * Sur macOS/Windows, les événements inotify ne se propagent pas de façon fiable à
 * travers les bind mounts de Docker Desktop : le watcher de Storybook ne se
 * déclenche pas et le HMR ne prend pas en compte les changements de stories/composants
 * (→ captures identiques à la baseline, aucun diff détecté). Le polling contourne ça :
 *   - WATCHPACK_POLLING : builder webpack (watchpack)
 *   - CHOKIDAR_USEPOLLING : indexeur de stories Storybook (chokidar)
 * Activé uniquement en conteneur (VR_DOCKER=1) pour éviter le coût CPU en natif.
 */
const withDockerPolling = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  if (process.env.VR_DOCKER !== "1") return env;
  return {
    ...env,
    WATCHPACK_POLLING: env.WATCHPACK_POLLING ?? "true",
    CHOKIDAR_USEPOLLING: env.CHOKIDAR_USEPOLLING ?? "true",
    CHOKIDAR_INTERVAL: env.CHOKIDAR_INTERVAL ?? "300",
  };
};

/**
 * Démarre `storybook dev` (HMR) sur le port donné.
 * STORYBOOK_ENV est passé via l'environnement (pas besoin de cross-env), et
 * node_modules/.bin est ajouté au PATH pour résoudre le binaire storybook.
 * En conteneur, le watching passe en polling (bind mount non fiable pour inotify).
 */
export const startDevStorybookServer = (projectRoot: string, port: number): ChildProcess => {
  const args = ["dev", "-p", String(port)];
  // Docker : écouter sur toutes les interfaces pour que le forward 6006:6006 fonctionne depuis l'hôte.
  if (process.env.VR_DOCKER === "1") {
    args.push("--host", "0.0.0.0");
  }
  return spawn("storybook", args, {
    stdio: "inherit",
    shell: true,
    cwd: projectRoot,
    env: withDockerPolling(withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" })),
  });
};

export type StartStorybookOptions = {
  projectRoot: string;
  port: number;
  mode?: StorybookMode;
  /** Chemin relatif du fichier de stats (mode static). */
  statsFile?: string;
  /** Nombre max de tentatives d'attente de l'index (secondes). */
  waitMaxAttempts?: number;
};

export type StartStorybookResult = {
  process: ChildProcess;
  ready: boolean;
  mode: StorybookMode;
};

/**
 * Démarre Storybook (dev ou static), attend l'indexation des stories.
 * En mode static, build préalable si nécessaire.
 */
export const startStorybook = async (options: StartStorybookOptions): Promise<StartStorybookResult> => {
  const { projectRoot, port, statsFile = "storybook-static/preview-stats.json", waitMaxAttempts = 120 } = options;
  const mode = options.mode ?? getStorybookMode();

  if (mode === "static") {
    if (needsStaticStorybookBuild(projectRoot, statsFile)) {
      const code = await buildStaticStorybook(projectRoot);
      if (code !== 0) {
        throw new Error(`Build Storybook statique échoué (code ${code})`);
      }
    }
    const proc = startStaticStorybookServer(projectRoot, port);
    const ready = await waitForStorybookStories(1, waitMaxAttempts, projectRoot);
    return { process: proc, ready, mode };
  }

  const proc = startDevStorybookServer(projectRoot, port);
  const ready = await waitForStorybookStories(1, waitMaxAttempts, projectRoot);
  return { process: proc, ready, mode };
};

/**
 * Rebuild + redémarre le serveur statique si les sources sont plus récentes que storybook-static.
 * Utilisé par le daemon avant chaque batch (le sidecar peut rester actif après des edits).
 */
export const ensureStaticStorybookFresh = async (options: {
  projectRoot: string;
  port: number;
  statsFile: string;
  currentProcess: ChildProcess | null;
  waitMaxAttempts?: number;
}): Promise<{ process: ChildProcess; ready: boolean; rebuilt: boolean }> => {
  const { projectRoot, port, statsFile, waitMaxAttempts = 120 } = options;

  if (!needsStaticStorybookBuild(projectRoot, statsFile)) {
    if (!options.currentProcess) {
      throw new Error("Serveur Storybook statique absent alors que le build est à jour");
    }
    return { process: options.currentProcess, ready: true, rebuilt: false };
  }

  console.log("🔄 [vr-storybook] Sources modifiées — rebuild Storybook statique…");
  stopStorybook(options.currentProcess);

  const code = await buildStaticStorybook(projectRoot);
  if (code !== 0) {
    throw new Error(`Build Storybook statique échoué (code ${code})`);
  }

  const proc = startStaticStorybookServer(projectRoot, port);
  const ready = await waitForStorybookStories(1, waitMaxAttempts, projectRoot);

  return { process: proc, ready, rebuilt: true };
};

/** Arrête proprement le process Storybook. */
export const stopStorybook = (proc: ChildProcess | null | undefined): void => {
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
};
