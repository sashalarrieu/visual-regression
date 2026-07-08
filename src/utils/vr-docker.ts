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
export const getDockerImage = (): string => process.env.VR_DOCKER_IMAGE || "ghcr.io/setshao/vr-capture:1.61.1";

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

/** Démarre le sidecar en arrière-plan (build si l'image locale est absente). */
export const composeUp = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["up", "-d", "--build"]);

/** Arrête et supprime le sidecar. */
export const composeDown = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["down"]);

/** Affiche l'état des services compose. */
export const composeStatus = (projectRoot: string): Promise<number> => runCompose(projectRoot, ["ps"]);
