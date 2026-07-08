/**
 * Gestion du sidecar Docker de capture depuis l'hôte (compose up/down/status).
 * Le conteneur héberge Storybook + le daemon de capture ; l'hôte n'exécute
 * jamais Playwright directement.
 */
import { spawn, spawnSync } from "child_process";
import path from "path";

import { getScriptDir } from "@utils/node";

const SCRIPT_DIR = getScriptDir(import.meta);
/** Racine du package (src/utils → ../..). */
const PACKAGE_ROOT = path.join(SCRIPT_DIR, "..", "..");

/** Chemin du docker-compose.yml embarqué dans le package. */
export const getComposeFile = (): string => path.join(PACKAGE_ROOT, "docker", "docker-compose.yml");

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
});

const runCompose = (projectRoot: string, args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn("docker", ["compose", "-f", getComposeFile(), ...args], {
      stdio: "inherit",
      cwd: projectRoot,
      env: composeEnv(projectRoot),
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

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

const pullPlaywrightBaseWithRetry = async (projectRoot: string, maxAttempts = 3): Promise<boolean> => {
  const image = getPlaywrightBaseImage();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`🐳 Pull base Playwright (${attempt}/${maxAttempts}): ${image}`);
    const code = await runDocker(projectRoot, ["pull", image]);
    if (code === 0) return true;
    if (attempt < maxAttempts) {
      await sleep(attempt * 3000);
    }
  }
  return false;
};

/** Démarre le sidecar en arrière-plan.
 * 1) Tente d'abord sans build (image prébuild / cache local) pour être rapide et robuste.
 * 2) Si échec, fallback sur --build.
 */
export const composeUp = async (projectRoot: string, forceBuild = false): Promise<number> => {
  if (forceBuild) {
    return runCompose(projectRoot, ["up", "-d", "--build", "--force-recreate"]);
  }

  const upCode = await runCompose(projectRoot, ["up", "-d"]);
  if (upCode === 0) return 0;

  await pullPlaywrightBaseWithRetry(projectRoot, 3);
  console.log("⚠️ docker compose up a échoué, tentative avec --build…");
  return runCompose(projectRoot, ["up", "-d", "--build"]);
};

/** Arrête et supprime le sidecar. */
export const composeDown = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["down"]);

/** Affiche l'état des services compose. */
export const composeStatus = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["ps"]);
