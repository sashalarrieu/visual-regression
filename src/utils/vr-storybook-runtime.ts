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
import { existsSync } from "fs";
import path from "path";

import { spawnShellOption, waitForStorybookStories } from "@utils/node";

export type StorybookMode = "dev" | "static";

/** Mode Storybook résolu (VR_STORYBOOK_MODE, défaut "dev"). */
export const getStorybookMode = (): StorybookMode =>
  (process.env.VR_STORYBOOK_MODE || "dev").toLowerCase() === "static" ? "static" : "dev";

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

/** true si un build statique de Storybook est nécessaire (absent ou stats manquantes). */
export const needsStaticStorybookBuild = (projectRoot: string, statsRelativePath: string): boolean => {
  if (process.env.VR_STORYBOOK_STATIC_REBUILD === "1") return true;
  const staticDir = path.join(projectRoot, "storybook-static");
  return !existsSync(path.join(staticDir, "index.html")) || !existsSync(path.join(projectRoot, statsRelativePath));
};

/** Build Storybook statique (--stats-json). Résout avec le code de sortie. */
export const buildStaticStorybook = (projectRoot: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn("yarn", ["storybook:build:stats"], {
      stdio: "inherit",
      cwd: projectRoot,
      env: withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" }),
      ...spawnShellOption,
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

/** Démarre `serve storybook-static` sur le port donné. */
export const startStaticStorybookServer = (projectRoot: string, port: number): ChildProcess =>
  spawn("npx", ["serve", "storybook-static", "-l", String(port)], {
    stdio: "inherit",
    shell: true,
    cwd: projectRoot,
    env: withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" }),
  });

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
export const startDevStorybookServer = (projectRoot: string, port: number): ChildProcess =>
  spawn("storybook", ["dev", "-p", String(port)], {
    stdio: "inherit",
    shell: true,
    cwd: projectRoot,
    env: withDockerPolling(withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" })),
  });

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
