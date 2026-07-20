/**
 * Gestion du sidecar Docker de capture depuis l'hôte (compose up/down/status/logs).
 * Le conteneur héberge Storybook + le daemon de capture ; l'hôte n'exécute
 * jamais Playwright directement.
 */
import type { ChildProcess } from "child_process";
import { spawn, spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

import { CAPTURE_DAEMON_PORT, STORYBOOK_PORT } from "../constants/constants";

import { getScriptDir } from "./node";
import { resolveVrConfig, VR_CONFIG_FILENAME } from "./vr-config";
import { getComposeProjectNameForRoot, getHostSidecarPorts, parseUrlPort } from "./vr-sidecar-ports";

const SCRIPT_DIR = getScriptDir(import.meta);
/** Racine du package (src/utils → ../..). */
const PACKAGE_ROOT = path.join(SCRIPT_DIR, "..", "..");

const PLAYWRIGHT_PULL_MAX_ATTEMPTS = 5;
const DOCKER_WORK_DIR = "/work";

/**
 * Convertit un chemin hôte (absolu ou relatif au projet) en chemin conteneur sous `/work`.
 * Sans ça, SBCONFIG_CONFIG_DIR absolu macOS/Windows est introuvable dans le sidecar.
 */
export const toDockerProjectPath = (projectRoot: string, hostPath: string): string => {
  const raw = hostPath.trim();
  if (!raw) return "";
  if (raw === DOCKER_WORK_DIR || raw.startsWith(`${DOCKER_WORK_DIR}/`)) return raw;

  const root = path.resolve(projectRoot);
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    // Hors du projet monté — laisser tel quel (échouera clairement si invalide)
    return raw.split(path.sep).join("/");
  }
  const posixRel = rel.split(path.sep).join("/");
  return posixRel ? `${DOCKER_WORK_DIR}/${posixRel}` : DOCKER_WORK_DIR;
};

export type DockerVolumeMount = { host: string; container: string };

/** Chemin du docker-compose.yml embarqué dans le package. */
export const getComposeFile = (): string => path.join(PACKAGE_ROOT, "docker", "docker-compose.yml");

/** Répertoire du compose file (utilisé comme cwd et pour le nom de projet). */
export const getComposeDirectory = (): string => path.dirname(getComposeFile());

/**
 * Nom de projet Docker Compose unique par racine hôte.
 * Évite de réutiliser le sidecar / volume node_modules d'un autre repo.
 */
export const getComposeProjectName = (projectRoot: string): string => getComposeProjectNameForRoot(projectRoot);

/** Nom legacy (avant fingerprint par projet) — pour `compose down` de sidecars orphelins. */
export const LEGACY_COMPOSE_PROJECT_NAME = "docker";

/** Image Docker par défaut (override VR_DOCKER_IMAGE). */
export const getDockerImage = (): string => process.env.VR_DOCKER_IMAGE || "vr-capture:1.61.1";

/** Image de base Playwright pour builder le sidecar (override VR_PLAYWRIGHT_IMAGE). */
export const getPlaywrightBaseImage = (): string =>
  process.env.VR_PLAYWRIGHT_IMAGE || "mcr.microsoft.com/playwright:v1.61.1-jammy";

/** true si la CLI docker est installée. */
export const isDockerCliAvailable = (): boolean => {
  try {
    const res = spawnSync("docker", ["--version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
};

/** true si le daemon Docker répond (Docker Desktop démarré sous Windows). */
export const isDockerDaemonRunning = (): boolean => {
  if (!isDockerCliAvailable()) return false;
  try {
    const res = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 8000 });
    return res.status === 0;
  } catch {
    return false;
  }
};

/** true si Docker CLI + daemon sont opérationnels. */
export const isDockerAvailable = (): boolean => isDockerDaemonRunning();

/** Volumes supplémentaires pour les dépendances `file:` (pnpm install dans Docker). */
export const getLinkedFileDependencyMounts = (projectRoot: string): DockerVolumeMount[] => {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return [];

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as typeof pkg;
  } catch {
    return [];
  }

  const specs = { ...pkg.dependencies, ...pkg.devDependencies };
  const mounts: DockerVolumeMount[] = [];
  const seen = new Set<string>();

  for (const spec of Object.values(specs)) {
    if (typeof spec !== "string" || !spec.startsWith("file:")) continue;

    const rel = spec.slice("file:".length);
    const hostPath = path.resolve(projectRoot, rel);
    const containerPath = path.posix.normalize(path.posix.join(DOCKER_WORK_DIR, rel.split(path.sep).join("/")));

    if (seen.has(containerPath)) continue;
    if (!existsSync(hostPath)) {
      console.warn(`⚠️ [vr-docker] Dépendance file: introuvable sur l'hôte : ${hostPath}`);
      continue;
    }

    seen.add(containerPath);
    mounts.push({ host: hostPath, container: containerPath });
  }

  return mounts;
};

const LINKED_PACKAGE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh"]);

/** Empreinte du code source d'un package file: monté (src + bin + package.json). */
const hashLinkedPackageSources = (hostRoot: string): string => {
  const hash = createHash("sha1");
  const pkgJson = path.join(hostRoot, "package.json");
  if (existsSync(pkgJson)) {
    hash.update(readFileSync(pkgJson));
  }

  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!LINKED_PACKAGE_SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      hash.update(full);
      hash.update(readFileSync(full));
    }
  };

  walk(path.join(hostRoot, "src"));
  walk(path.join(hostRoot, "bin"));
  return hash.digest("hex");
};

/**
 * Invalide le cache d'install Docker (.vr-cache/docker-deps.hash) quand le code
 * d'une dépendance file: change. Sinon pnpm réutilise une copie figée dans le volume
 * node_modules du conteneur et ignore le bind mount /visual-regression.
 */
export const invalidateDockerDepsCacheIfLinkedPackagesChanged = (projectRoot: string): void => {
  const mounts = getLinkedFileDependencyMounts(projectRoot);
  if (mounts.length === 0) return;

  const cacheDir = path.join(projectRoot, ".vr-cache");
  mkdirSync(cacheDir, { recursive: true });
  const linkedHashFile = path.join(cacheDir, "docker-linked-src.hash");
  const depsHashFile = path.join(cacheDir, "docker-deps.hash");

  const currentHash = createHash("sha1")
    .update(mounts.map(m => `${m.container}:${hashLinkedPackageSources(m.host)}`).join("|"))
    .digest("hex");

  const previousHash = existsSync(linkedHashFile) ? readFileSync(linkedHashFile, "utf8").trim() : "";
  if (currentHash === previousHash) return;

  if (existsSync(depsHashFile)) {
    try {
      unlinkSync(depsHashFile);
    } catch {
      // ignore
    }
  }
  writeFileSync(linkedHashFile, currentHash, "utf8");
  console.log("🐳 [vr-docker] Dépendance(s) file: modifiée(s) — réinstallation au démarrage du sidecar");
};

const formatDockerVolumePath = (hostPath: string): string => path.resolve(hostPath).replace(/\\/g, "/");

/** Génère un override compose pour monter les packages locaux liés via file:. */
export const writeComposeLinkedPackagesOverride = (projectRoot: string): string | null => {
  const mounts = getLinkedFileDependencyMounts(projectRoot);
  if (mounts.length === 0) return null;

  const cacheDir = path.join(projectRoot, ".vr-cache");
  mkdirSync(cacheDir, { recursive: true });
  const overridePath = path.join(cacheDir, "docker-compose.linked-packages.yml");

  const volumeLines = mounts
    .flatMap(m => [
      `      - "${formatDockerVolumePath(m.host)}:${m.container}"`,
      // Masque le node_modules de l'hôte (binaires Darwin/Windows) pour forcer
      // la résolution via le volume Linux /work/node_modules après install Docker.
      `      - "${m.container}/node_modules"`,
    ])
    .join("\n");

  const vrMount = mounts.find(m => existsSync(path.join(m.host, "bin", "visual-regression.mjs")));
  const entrypointLine = vrMount ? `    entrypoint: ["/bin/sh", "${vrMount.container}/docker/entrypoint.sh"]\n` : "";

  writeFileSync(
    overridePath,
    `# Généré par @setshao/visual-regression — monte les dépendances file: pour install Docker\n` +
      `# (+ volume anonyme sur */node_modules pour éviter les binaires natifs de l'hôte)\n` +
      (vrMount ? `# Entrypoint monté : code lib live (évite copie figée dans le volume node_modules).\n` : "") +
      `services:\n  vr-capture:\n${entrypointLine}    volumes:\n${volumeLines}\n`,
    "utf8",
  );

  console.log(
    `🐳 [vr-docker] ${mounts.length} dépendance(s) file: montée(s) dans le sidecar (${mounts.map(m => m.container).join(", ")})`,
  );
  return overridePath;
};

export const getComposeFiles = (projectRoot: string): string[] => {
  const files = [getComposeFile()];
  const override = writeComposeLinkedPackagesOverride(projectRoot);
  if (override) files.push(override);
  return files;
};

/** Ports hôte Publish (overrides config/env inclus via resolveVrConfig). */
const getComposeHostPorts = (projectRoot: string): { storybookPort: number; daemonPort: number } => {
  try {
    const config = resolveVrConfig(projectRoot);
    return {
      storybookPort: parseUrlPort(config.storybook.url, STORYBOOK_PORT),
      daemonPort: parseUrlPort(config.capture.daemonUrl, CAPTURE_DAEMON_PORT),
    };
  } catch {
    const derived = getHostSidecarPorts(projectRoot);
    return { storybookPort: derived.storybookPort, daemonPort: derived.daemonPort };
  }
};

const composeEnv = (projectRoot: string): NodeJS.ProcessEnv => {
  const composeProjectName = getComposeProjectName(projectRoot);
  const hostPorts = getComposeHostPorts(projectRoot);
  return {
    ...process.env,
    VR_PROJECT_ROOT: projectRoot,
    VR_HOST_PROJECT_ROOT: projectRoot,
    VR_COMPOSE_PROJECT_NAME: composeProjectName,
    VR_HOST_STORYBOOK_PORT: String(hostPorts.storybookPort),
    VR_HOST_DAEMON_PORT: String(hostPorts.daemonPort),
    VR_STORYBOOK_MODE: process.env.VR_STORYBOOK_MODE || "",
    SBCONFIG_CONFIG_DIR: toDockerProjectPath(projectRoot, process.env.SBCONFIG_CONFIG_DIR || ""),
    VR_DOCKER_IMAGE: getDockerImage(),
    COMPOSE_PROJECT_NAME: composeProjectName,
  };
};

const composeArgs = (projectRoot: string, args: string[]): string[] => [
  "compose",
  "-p",
  getComposeProjectName(projectRoot),
  ...getComposeFiles(projectRoot).flatMap(file => ["-f", file]),
  ...args,
];

const runCompose = (projectRoot: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn("docker", composeArgs(projectRoot, args), {
      stdio: "inherit",
      cwd: getComposeDirectory(),
      env: composeEnv(projectRoot),
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

/** Arrêt synchrone du sidecar — fiable pendant SIGINT (Windows) où l'async peut être interrompu. */
export const composeDownSync = (projectRoot: string): number => {
  const res = spawnSync("docker", composeArgs(projectRoot, ["down"]), {
    stdio: "inherit",
    cwd: getComposeDirectory(),
    env: composeEnv(projectRoot),
  });
  return res.status ?? 1;
};

/**
 * Arrête un stack Compose par nom de projet (sidecar d'un autre repo, ou nom legacy).
 * N'utilise que le compose de base (pas les overrides file: du projet courant).
 */
export const composeDownByName = (composeProjectName: string): number => {
  const name = composeProjectName.trim();
  if (!name) return 1;
  const res = spawnSync("docker", ["compose", "-p", name, "-f", getComposeFile(), "down"], {
    stdio: "inherit",
    cwd: getComposeDirectory(),
    env: { ...process.env, COMPOSE_PROJECT_NAME: name },
  });
  return res.status ?? 1;
};

const runDocker = (projectRoot: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: "inherit",
      cwd: projectRoot,
      env: composeEnv(projectRoot),
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** true si l'image est déjà présente dans le cache Docker local. */
const dockerImageExists = (image: string): boolean => {
  const res = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" });
  return res.status === 0;
};

/**
 * Garantit que l'image de base Playwright est disponible avant un build.
 * Skip le pull si déjà en cache ; retries avec backoff en cas d'EOF réseau (MCR).
 */
const ensurePlaywrightBaseImage = async (projectRoot: string): Promise<boolean> => {
  const image = getPlaywrightBaseImage();
  if (dockerImageExists(image)) return true;

  for (let attempt = 1; attempt <= PLAYWRIGHT_PULL_MAX_ATTEMPTS; attempt += 1) {
    console.log(`🐳 Téléchargement de l'image Playwright (${attempt}/${PLAYWRIGHT_PULL_MAX_ATTEMPTS})…`);
    const code = await runDocker(projectRoot, ["pull", image]);
    if (code === 0) return true;
    if (attempt < PLAYWRIGHT_PULL_MAX_ATTEMPTS) {
      await sleep(attempt * 3000);
    }
  }
  return false;
};

const applyResolvedDockerEnv = (projectRoot: string): void => {
  const configPath = path.join(projectRoot, VR_CONFIG_FILENAME);
  if (!existsSync(configPath)) return;
  const config = resolveVrConfig(projectRoot);
  if (!process.env.VR_DOCKER_IMAGE && config.docker.image) {
    process.env.VR_DOCKER_IMAGE = config.docker.image;
  }
  if (!process.env.VR_PLAYWRIGHT_IMAGE && config.docker.playwrightImage) {
    process.env.VR_PLAYWRIGHT_IMAGE = config.docker.playwrightImage;
  }
};

/** Démarre le sidecar en arrière-plan (build automatique au 1er lancement si besoin). */
export const composeUp = async (projectRoot: string, forceBuild = false): Promise<number> => {
  invalidateDockerDepsCacheIfLinkedPackagesChanged(projectRoot);
  applyResolvedDockerEnv(projectRoot);

  if (forceBuild) {
    await ensurePlaywrightBaseImage(projectRoot);
    return runCompose(projectRoot, ["up", "-d", "--build", "--force-recreate"]);
  }

  const captureImage = getDockerImage();
  if (!dockerImageExists(captureImage)) {
    await ensurePlaywrightBaseImage(projectRoot);
    return runCompose(projectRoot, ["up", "-d", "--build"]);
  }

  const upCode = await runCompose(projectRoot, ["up", "-d"]);
  if (upCode === 0) return 0;

  await ensurePlaywrightBaseImage(projectRoot);
  return runCompose(projectRoot, ["up", "-d", "--build"]);
};

/** Arrête et supprime le sidecar. */
export const composeDown = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["down"]);

/** Affiche l'état des services compose. */
export const composeStatus = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["ps"]);

/**
 * Suit les logs du sidecar dans le terminal hôte (`docker compose logs -f`).
 * À utiliser quand `docker.showLogs` / `VR_DOCKER_SHOW_LOGS` est activé.
 */
export const followComposeLogs = (projectRoot: string, options?: { tail?: number }): ChildProcess => {
  const tail = options?.tail ?? 100;
  return spawn("docker", composeArgs(projectRoot, ["logs", "-f", "--tail", String(tail)]), {
    stdio: "inherit",
    cwd: getComposeDirectory(),
    env: composeEnv(projectRoot),
  });
};

/** Arrête le processus de suivi des logs (sans toucher au conteneur). */
export const stopComposeLogs = (proc: ChildProcess | null | undefined): void => {
  if (!proc || proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
};

/** Dump one-shot des dernières lignes de logs (diagnostic si le daemon ne démarre pas). */
export const dumpComposeLogs = (projectRoot: string, tail = 80): void => {
  spawnSync("docker", composeArgs(projectRoot, ["logs", "--tail", String(tail)]), {
    stdio: "inherit",
    cwd: getComposeDirectory(),
    env: composeEnv(projectRoot),
  });
};

/** `compose down -v` — retire aussi le volume node_modules Linux (réinstall propre). */
export const composeDownVolumes = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["down", "-v"]);
