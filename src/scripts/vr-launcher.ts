// scripts/vr-launcher.ts (package @setshao/visual-regression)
import { spawn } from "child_process";
import path from "path";

import {
  EXPO_PORT,
  EXPO_URL,
  LOCAL_URL,
  LOG_COLORS,
  STORYBOOK_PORT,
  STORYBOOK_URL,
  VR_SERVER_PORT,
  VR_SERVER_URL,
} from "@constants/constants";
import { assertVrDevicesConfig, getProjectRoot, getScriptDir } from "@utils/node";

const SCRIPT_DIR = getScriptDir(import.meta);
const PACKAGE_ROOT = path.join(SCRIPT_DIR, "..", "..");
const PROJECT_ROOT = getProjectRoot();

const log = (color: keyof typeof LOG_COLORS, prefix: string, message: string) => {
  console.log(`${LOG_COLORS[color]}${prefix}${LOG_COLORS.reset} ${message}`);
};

const isPortAvailable = async (port: number): Promise<boolean> => {
  try {
    await fetch(`${LOCAL_URL}:${port}`);
    return false;
  } catch {
    return true;
  }
};

const waitForServer = async (port: number, maxAttempts = 30): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    const available = await isPortAvailable(port);
    if (!available) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};

const killPort = (port: number) => {
  try {
    log("yellow", "⚠️", `Tentative de libération du port ${port}`);
    const process = spawn("lsof", ["-ti", `:${port}`]);

    process.stdout.on("data", data => {
      const pid = data.toString().trim();
      if (pid) {
        spawn("kill", ["-9", pid]);
        log("green", "✅", `Port ${port} libéré (PID: ${pid})`);
      }
    });
  } catch {
    log("red", "❌", `Impossible de libérer le port ${port}`);
  }
};

const main = async () => {
  assertVrDevicesConfig(PROJECT_ROOT);

  log("blue", "🚀", "Démarrage de l'environnement Visual Regressions");

  log("blue", "📋", "Vérification des ports");

  const expoAvailable = await isPortAvailable(EXPO_PORT);
  const vrServerAvailable = await isPortAvailable(VR_SERVER_PORT);
  const storybookAvailable = await isPortAvailable(STORYBOOK_PORT);

  if (!expoAvailable) {
    log("yellow", "⚠️", `Le port ${EXPO_PORT} est déjà utilisé`);
    killPort(EXPO_PORT);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (!vrServerAvailable) {
    log("yellow", "⚠️", `Le port ${VR_SERVER_PORT} est déjà utilisé`);
    killPort(VR_SERVER_PORT);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  let storybookAlreadyRunning = false;
  if (!storybookAvailable) {
    storybookAlreadyRunning = true;
  }

  log("blue", "🔧", "Démarrage du serveur VR");

  const vrServerScript = path.join(SCRIPT_DIR, "vr-server.ts");
  const vrServer = spawn("bun", [vrServerScript], {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
    env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
  });

  vrServer.on("error", err => {
    log("red", "❌", `Erreur serveur VR: ${err.message}`);
    process.exit(1);
  });

  const vrReady = await waitForServer(VR_SERVER_PORT);
  if (!vrReady) {
    log("red", "❌", "Le serveur VR n'a pas démarré à temps");
    process.exit(1);
  }

  log("green", "✅", "Serveur VR prêt");

  let storybook: ReturnType<typeof spawn> | null = null;

  if (storybookAlreadyRunning) {
    const storybookReady = await waitForServer(STORYBOOK_PORT, 1);
    if (!storybookReady) {
      log("red", "❌", "Storybook ne répond pas sur le port attendu");
      vrServer.kill();
      process.exit(1);
    }
    log("green", "✅", "Storybook prêt");
  } else {
    log("blue", "📚", "Démarrage de Storybook");

    storybook = spawn("cross-env", ["STORYBOOK_ENV=web", "storybook", "dev", "-p", String(STORYBOOK_PORT)], {
      stdio: "inherit",
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, STORYBOOK_ENV: "web" },
    });

    storybook.on("error", err => {
      log("red", "❌", `Erreur Storybook: ${err.message}`);
      vrServer.kill();
      process.exit(1);
    });

    const storybookReady = await waitForServer(STORYBOOK_PORT, 60);
    if (!storybookReady) {
      log("red", "❌", "Storybook n'a pas démarré à temps");
      vrServer.kill();
      process.exit(1);
    }

    log("green", "✅", "Storybook prêt");
  }

  log("blue", "📱", "Démarrage de l'interface VR (Expo depuis le package)");

  const expo = spawn("cross-env", ["expo", "start", "--web", "--clear", "--port", String(EXPO_PORT)], {
    stdio: "inherit",
    shell: true,
    cwd: PACKAGE_ROOT,
    env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
  });

  expo.on("error", err => {
    log("red", "❌", `Erreur Expo: ${err.message}`);
    vrServer.kill();
    if (storybook) {
      storybook.kill();
    }
    process.exit(1);
  });

  const expoReady = await waitForServer(EXPO_PORT, 60);
  if (!expoReady) {
    log("red", "❌", "Expo n'a pas démarré à temps");
    vrServer.kill();
    if (storybook) {
      storybook.kill();
    }
    process.exit(1);
  }

  log("green", "✅", "Expo prêt");

  const compareScript = path.join(SCRIPT_DIR, "compare-visual-regressions.ts");
  log("blue", "🔍", "Lancement de la comparaison initiale");

  const compare = spawn("bun", [compareScript], {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
    env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
  });

  compare.on("close", code => {
    if (code === 0) {
      log("green", "✅", "Comparaison initiale terminée");
      log("green", "🎉", "Environnement VR prêt !");
      log("blue", "🌐", `Interface VR disponible sur ${EXPO_URL}`);
      log("blue", "🔧", `Serveur VR API sur ${VR_SERVER_URL}`);
      log("blue", "📚", `Storybook disponible sur ${STORYBOOK_URL}`);
    } else {
      log("yellow", "⚠️", `Comparaison terminée avec le code ${code}`);
    }
  });

  process.on("SIGINT", () => {
    log("yellow", "⚠️", "Arrêt en cours");
    expo.kill();
    if (storybook) {
      storybook.kill();
    }
    vrServer.kill();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log("yellow", "⚠️", "Arrêt en cours");
    expo.kill();
    if (storybook) {
      storybook.kill();
    }
    vrServer.kill();
    process.exit(0);
  });
};

main().catch(err => {
  log("red", "❌", `Erreur fatale: ${err.message}`);
  process.exit(1);
});
