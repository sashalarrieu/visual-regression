/**
 * Lancement de Storybook pour la capture VR (dev HMR ou statique).
 * Utilisé par le daemon de capture (sidecar Docker) et réutilisable par le launcher.
 *
 * - mode "dev"    : `storybook dev` (HMR). Défaut local — identique à `yarn storybook`.
 * - mode "static" : build `storybook-static` (+ stats) puis serve. CI
 *   (`VR_STORYBOOK_MODE=static` / docker-compose.ci.yml). Rebuild si l'empreinte
 *   des sources change (pas le mtime Docker Desktop).
 */
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getPackageScriptCommand, getProjectRoot, spawnShellOption, waitForStorybookStories } from "./node";
import { resolveVrConfig, VR_CONFIG_FILENAME } from "./vr-config";

/** Racine du package visual-regression (src/utils → ../..). */
const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
 *
 * Local (`yarn vr`) : **dev** (HMR) par défaut — identique à `yarn storybook`.
 * Override : `VR_STORYBOOK_MODE` > `launcher.storybookMode` dans `vr.config.cjs`.
 * CI / oneshot : `VR_STORYBOOK_MODE=static` (docker-compose.ci.yml).
 * Exception : `@storybook/nextjs-vite` reste en static (dev headless vide).
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

  // Next.js Vite : le mode dev ne rend pas les stories en capture Playwright.
  if (usesNextJsViteStorybook(projectRoot)) {
    return "static";
  }

  return "dev";
};

/** Mode Storybook résolu (env > vr.config > auto Docker/static). */
export const getStorybookMode = (): StorybookMode => {
  try {
    return resolveStorybookModeForCapture(getProjectRoot());
  } catch {
    const envMode = (process.env.VR_STORYBOOK_MODE || "").toLowerCase();
    if (envMode === "static" || envMode === "dev") {
      return envMode === "static" ? "static" : "dev";
    }
    return "dev";
  }
};

/**
 * Répertoires node_modules/.bin où le CLI `storybook` peut se trouver
 * (racine, package workspace, dossier dérivé de SBCONFIG_CONFIG_DIR).
 */
export const resolveStorybookBinDirs = (projectRoot: string): string[] => {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string): void => {
    const resolved = path.resolve(dir);
    if (seen.has(resolved) || !existsSync(resolved)) return;
    seen.add(resolved);
    dirs.push(resolved);
  };

  add(path.join(projectRoot, "node_modules", ".bin"));
  add(path.join(projectRoot, "apps", "storybook", "node_modules", ".bin"));

  const sbconfig = process.env.SBCONFIG_CONFIG_DIR?.trim();
  if (sbconfig) {
    const configAbs = path.resolve(projectRoot, sbconfig);
    // apps/storybook/.storybook → apps/storybook/node_modules/.bin
    add(path.join(path.dirname(configAbs), "node_modules", ".bin"));
  }

  return dirs;
};

/** Chemin absolu du binaire storybook, ou null. */
export const resolveStorybookBin = (projectRoot: string): string | null => {
  for (const binDir of resolveStorybookBinDirs(projectRoot)) {
    const candidate = path.join(binDir, "storybook");
    if (existsSync(candidate)) return candidate;
    if (process.platform === "win32" && existsSync(`${candidate}.cmd`)) return `${candidate}.cmd`;
  }
  return null;
};

/**
 * Ajoute les node_modules/.bin pertinents au PATH (racine + workspace Storybook).
 * Nécessaire quand on spawn des binaires locaux hors yarn/npm/pnpm — notamment Docker.
 */
const withLocalBinPath = (projectRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const sep = process.platform === "win32" ? ";" : ":";
  const currentPath = env.PATH ?? process.env.PATH ?? "";
  const binDirs = resolveStorybookBinDirs(projectRoot);
  if (binDirs.length === 0) {
    const fallback = path.join(projectRoot, "node_modules", ".bin");
    return { ...env, PATH: `${fallback}${sep}${currentPath}` };
  }
  return { ...env, PATH: `${binDirs.join(sep)}${sep}${currentPath}` };
};

const STORYBOOK_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".css",
  ".scss",
  ".mdx",
  ".html",
]);

export const STORYBOOK_INPUT_FINGERPRINT_FILE = ".vr-cache/storybook-input.fingerprint";

const storybookInputRoots = (projectRoot: string): string[] => [
  path.join(projectRoot, "src"),
  path.join(projectRoot, ".storybook"),
  path.join(projectRoot, "apps", "storybook"),
  path.join(projectRoot, "node_modules", "@setshao", "visual-regression", "src", "storybook"),
  path.join(projectRoot, "node_modules", "@setshao", "visual-regression", "src", "utils"),
  path.join(projectRoot, "..", "visual-regression", "src", "storybook"),
  path.join(projectRoot, "..", "visual-regression", "src", "utils"),
];

const collectStorybookInputFiles = (projectRoot: string): string[] => {
  const files: string[] = [];
  const seen = new Set<string>();

  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "Screenshots" || entry.name === "storybook-static") {
          continue;
        }
        walk(full);
        continue;
      }
      if (!STORYBOOK_SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const resolved = path.resolve(full);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      files.push(resolved);
    }
  };

  for (const root of storybookInputRoots(projectRoot)) {
    walk(root);
  }

  return files.sort();
};

/** Empreinte du contenu des sources Storybook (mtime Docker Desktop non fiable). */
export const computeStorybookInputFingerprint = (projectRoot: string): string => {
  const hash = createHash("sha1");
  for (const file of collectStorybookInputFiles(projectRoot)) {
    hash.update(path.relative(projectRoot, file));
    hash.update("\0");
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("missing");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
};

export const readStoredStorybookInputFingerprint = (projectRoot: string): string | null => {
  const fingerprintPath = path.join(projectRoot, STORYBOOK_INPUT_FINGERPRINT_FILE);
  if (!existsSync(fingerprintPath)) return null;
  try {
    const value = readFileSync(fingerprintPath, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

export const writeStoredStorybookInputFingerprint = (projectRoot: string, fingerprint?: string): void => {
  const fingerprintPath = path.join(projectRoot, STORYBOOK_INPUT_FINGERPRINT_FILE);
  mkdirSync(path.dirname(fingerprintPath), { recursive: true });
  writeFileSync(fingerprintPath, `${fingerprint ?? computeStorybookInputFingerprint(projectRoot)}\n`, "utf8");
};

/** true si un build statique de Storybook est nécessaire (absent, stats manquantes ou sources changées). */
export const needsStaticStorybookBuild = (projectRoot: string, statsRelativePath: string): boolean => {
  if (process.env.VR_STORYBOOK_STATIC_REBUILD === "1") return true;
  try {
    if (
      existsSync(path.join(projectRoot, VR_CONFIG_FILENAME)) &&
      resolveVrConfig(projectRoot).launcher.forceStaticRebuild
    ) {
      return true;
    }
  } catch {
    // ignore
  }
  const staticIndex = path.join(projectRoot, "storybook-static", "index.html");
  const statsPath = path.join(projectRoot, statsRelativePath);
  if (!existsSync(staticIndex) || !existsSync(statsPath)) return true;

  const stored = readStoredStorybookInputFingerprint(projectRoot);
  if (!stored) return true;
  return stored !== computeStorybookInputFingerprint(projectRoot);
};

/**
 * Copie le contenu de `assets/` dans `storybook-static/assets/` (merge).
 * `preview-head.html` référence `../assets/fonts/…` → `/assets/fonts/…` en static ;
 * sans staticDirs Storybook, ces fichiers 404 et les captures tombent en serif système.
 *
 * Attention : `storybook-static/assets/` existe déjà (JS Vite). On merge les enfants
 * (`fonts/`, …) — pas un `cp assets → assets` qui créerait `assets/assets/`.
 */
export const ensureStorybookStaticAssets = (projectRoot: string): void => {
  const staticDir = path.join(projectRoot, "storybook-static");
  const from = path.join(projectRoot, "assets");
  const to = path.join(staticDir, "assets");
  if (!existsSync(staticDir) || !existsSync(from)) return;

  try {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dest = path.join(to, entry.name);
      cpSync(src, dest, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(
      "[vr-storybook] Impossible de copier assets/ → storybook-static/assets/:",
      error instanceof Error ? error.message : error,
    );
  }
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

/** Démarre le serveur static storybook-static (vr-static-server, pas `serve`). */
export const startStaticStorybookServer = (projectRoot: string, port: number): ChildProcess => {
  const staticDir = path.join(projectRoot, "storybook-static");
  ensureStorybookStaticAssets(projectRoot);

  // Ancien serve.json laissé pour compat / outils externes — plus utilisé par le serveur VR.
  try {
    writeFileSync(
      path.join(staticDir, "serve.json"),
      `${JSON.stringify(
        {
          cleanUrls: false,
          trailingSlash: false,
          directoryListing: false,
          redirects: [{ source: "/", destination: "/index.html", type: 302 }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // best-effort
  }

  const serverScript = path.join(PACKAGE_ROOT, "src", "scripts", "vr-static-server.mjs");
  const listenArg = process.env.VR_DOCKER === "1" ? `tcp://0.0.0.0:${port}` : String(port);

  // Résoudre le script depuis le package lié (node_modules ou monorepo).
  const candidates = [
    serverScript,
    path.join(projectRoot, "node_modules", "@setshao", "visual-regression", "src", "scripts", "vr-static-server.mjs"),
    path.join(projectRoot, "..", "visual-regression", "src", "scripts", "vr-static-server.mjs"),
  ];
  const scriptPath = candidates.find(p => existsSync(p));
  if (!scriptPath) {
    throw new Error(
      "[vr-storybook] vr-static-server.mjs introuvable — vérifiez @setshao/visual-regression (src/scripts).",
    );
  }

  return spawn(process.execPath, [scriptPath, staticDir, listenArg], {
    stdio: "inherit",
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
    CHOKIDAR_INTERVAL: env.CHOKIDAR_INTERVAL ?? "200",
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
  const storybookBin = resolveStorybookBin(projectRoot);
  const envForSpawn = withDockerPolling(withLocalBinPath(projectRoot, { ...process.env, STORYBOOK_ENV: "web" }));
  if (!storybookBin) {
    console.error(
      "❌ [vr-storybook] Binaire `storybook` introuvable. " +
        "Ajoutez la dépendance `storybook` (racine ou package workspace) " +
        "ou définissez SBCONFIG_CONFIG_DIR vers le dossier .storybook du package qui l'embarque.",
    );
  }
  return spawn(storybookBin ?? "storybook", args, {
    stdio: "inherit",
    shell: true,
    cwd: projectRoot,
    env: envForSpawn,
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
      ensureStorybookStaticAssets(projectRoot);
      writeStoredStorybookInputFingerprint(projectRoot);
    } else {
      // Build déjà là : quand même (re)copier fonts/assets (souvent oubliés hors staticDirs).
      ensureStorybookStaticAssets(projectRoot);
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
  writeStoredStorybookInputFingerprint(projectRoot);

  return { process: proc, ready, rebuilt: true };
};

const sleepMs = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Attend que l'index Storybook dev se stabilise (HMR en cours après un save).
 * Ne jette pas : un timeout ne doit pas bloquer la capture.
 */
export const waitForDevStorybookIndexSettle = async (
  storybookUrl: string,
  options?: { stableMs?: number; timeoutMs?: number },
): Promise<void> => {
  const stableMs = options?.stableMs ?? 400;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const deadline = Date.now() + timeoutMs;
  const url = `${storybookUrl.replace(/\/$/, "")}/index.json`;
  let last = "";
  let lastAt = 0;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const text = res.ok ? await res.text() : "";
      if (text && text === last && Date.now() - lastAt >= stableMs) return;
      if (text !== last) {
        last = text;
        lastAt = Date.now();
      }
    } catch {
      // Storybook encore en reload
    }
    await sleepMs(150);
  }
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
