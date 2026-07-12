/**
 * Gestion du sidecar Docker de capture depuis l'hôte (compose up/down/status).
 * Le conteneur héberge Storybook + le daemon de capture ; l'hôte n'exécute
 * jamais Playwright directement.
 */
import { spawn, spawnSync } from "child_process";
import path from "path";

import { getScriptDir } from "./node";

const SCRIPT_DIR = getScriptDir(import.meta);
/** Racine du package (src/utils → ../..). */
const PACKAGE_ROOT = path.join(SCRIPT_DIR, "..", "..");

const PLAYWRIGHT_PULL_MAX_ATTEMPTS = 5;

/** Chemin du docker-compose.yml embarqué dans le package. */
export const getComposeFile = (): string => path.join(PACKAGE_ROOT, "docker", "docker-compose.yml");

/** Répertoire du compose file (utilisé comme cwd et pour le nom de projet). */
export const getComposeDirectory = (): string => path.dirname(getComposeFile());

/** Nom de projet Docker Compose (dossier parent du compose file, ex. "docker"). */
export const getComposeProjectName = (): string => path.basename(getComposeDirectory());

/** Image Docker par défaut (override VR_DOCKER_IMAGE). */
export const getDockerImage = (): string => process.env.VR_DOCKER_IMAGE || "vr-capture:1.61.1";

/** Image de base Playwright pour builder le sidecar (override VR_PLAYWRIGHT_IMAGE). */
export const getPlaywrightBaseImage = (): string =>
  process.env.VR_PLAYWRIGHT_IMAGE || "mcr.microsoft.com/playwright:v1.61.1-jammy";

/** true si la CLI docker est disponible. */
export const isDockerAvailable = (): boolean => {
  try {
    const res = spawnSync("docker", ["--version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
};

const composeEnv = (projectRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  VR_PROJECT_ROOT: projectRoot,
  VR_STORYBOOK_MODE: process.env.VR_STORYBOOK_MODE || "dev",
  VR_DOCKER_IMAGE: getDockerImage(),
  COMPOSE_PROJECT_NAME: getComposeProjectName(),
});

const composeArgs = (args: string[]): string[] => [
  "compose",
  "-p",
  getComposeProjectName(),
  "-f",
  getComposeFile(),
  ...args,
];

const runCompose = (projectRoot: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn("docker", composeArgs(args), {
      stdio: "inherit",
      cwd: getComposeDirectory(),
      env: composeEnv(projectRoot),
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

/** Arrêt synchrone du sidecar — fiable pendant SIGINT (Windows) où l'async peut être interrompu. */
export const composeDownSync = (projectRoot: string): number => {
  const res = spawnSync("docker", composeArgs(["down"]), {
    stdio: "inherit",
    cwd: getComposeDirectory(),
    env: composeEnv(projectRoot),
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

/** Démarre le sidecar en arrière-plan (build automatique au 1er lancement si besoin). */
export const composeUp = async (projectRoot: string, forceBuild = false): Promise<number> => {
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
