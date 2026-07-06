// scripts/vr-launcher.ts (package @setshao/visual-regression)
import { spawn } from "child_process";
import { existsSync } from "fs";
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
import {
  assertVrConfig,
  getNodeTsxArgs,
  getProjectRoot,
  getScriptDir,
  getTsxCliPath,
  spawnShellOption,
  waitForStorybookStories,
} from "@utils/node";

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
  log("yellow", "⚠️", `Tentative de libération du port ${port}`);
  const isWin = process.platform === "win32";
  if (isWin) {
    try {
      const netstat = spawn("netstat", ["-ano"], { ...spawnShellOption, stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      netstat.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      netstat.on("close", (code: number) => {
        if (code !== 0) return;
        const lines = out.split("\n").filter(l => l.trim().includes(`:${port}`));
        const pids = new Set<string>();
        for (const line of lines) {
          const m = line.trim().split(/\s+/);
          const pid = m[m.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
        }
        for (const pid of pids) {
          try {
            spawn("taskkill", ["/PID", pid, "/F"], { ...spawnShellOption, stdio: "ignore" });
            log("green", "✅", `Port ${port} libéré (PID: ${pid})`);
          } catch {
            // ignore
          }
        }
      });
      netstat.on("error", () => log("red", "❌", `Impossible de libérer le port ${port}`));
    } catch {
      log("red", "❌", `Impossible de libérer le port ${port}`);
    }
    return;
  }
  try {
    const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: ["ignore", "pipe", "ignore"] });
    proc.on("error", () => log("red", "❌", `Impossible de libérer le port ${port} (lsof non disponible)`));
    proc.stdout?.on("data", (data: Buffer) => {
      const pid = data.toString().trim();
      if (pid) {
        try {
          spawn("kill", ["-9", pid], { stdio: "ignore" });
          log("green", "✅", `Port ${port} libéré (PID: ${pid})`);
        } catch {
          // ignore
        }
      }
    });
  } catch {
    log("red", "❌", `Impossible de libérer le port ${port}`);
  }
};

const main = async () => {
  assertVrConfig(PROJECT_ROOT);

  log("blue", "🚀", "Démarrage de l'environnement Visual Regressions");

  log("blue", "📋", "Vérification des ports");

  const expoAvailable = await isPortAvailable(EXPO_PORT);
  const vrServerAvailable = await isPortAvailable(VR_SERVER_PORT);
  const storybookAvailable = await isPortAvailable(STORYBOOK_PORT);

  if (!expoAvailable) {
    log("yellow", "⚠️", `Le port ${EXPO_PORT} est déjà utilisé`);
    killPort(EXPO_PORT);
    await new Promise(resolve => setTimeout(resolve, process.platform === "win32" ? 3500 : 2000));
  }

  if (!vrServerAvailable) {
    log("yellow", "⚠️", `Le port ${VR_SERVER_PORT} est déjà utilisé`);
    killPort(VR_SERVER_PORT);
    await new Promise(resolve => setTimeout(resolve, process.platform === "win32" ? 3500 : 2000));
  }

  let storybookAlreadyRunning = false;
  if (!storybookAvailable) {
    const storiesIndexed = await waitForStorybookStories(1, 3);
    if (storiesIndexed) {
      storybookAlreadyRunning = true;
    } else {
      log("yellow", "⚠️", `Port ${STORYBOOK_PORT} occupé mais index Storybook vide — redémarrage`);
      killPort(STORYBOOK_PORT);
      await new Promise(resolve => setTimeout(resolve, process.platform === "win32" ? 3500 : 2000));
    }
  }

  log("blue", "🔧", "Démarrage du serveur VR");

  const { command: nodeTsxCommand, args: nodeTsxArgs } = getNodeTsxArgs(path.join(SCRIPT_DIR, "vr-server.ts"));
  const vrServer = spawn(nodeTsxCommand, nodeTsxArgs, {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
    env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
    ...spawnShellOption,
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
    log("green", "✅", "Storybook prêt (instance existante)");
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

    const storiesIndexed = await waitForStorybookStories(1, 90);
    if (!storiesIndexed) {
      log("red", "❌", "Storybook n'a pas indexé les stories à temps");
      vrServer.kill();
      if (storybook) {
        storybook.kill();
      }
      process.exit(1);
    }

    log("green", "✅", "Storybook prêt");
  }

  log("blue", "📱", "Démarrage de l'interface VR (Expo depuis le package)");

  const expoArgs = ["expo", "start", "--web", "--port", String(EXPO_PORT)];
  if (process.env.VR_CLEAR_METRO === "1") {
    expoArgs.push("--clear");
  }

  const expo = spawn("cross-env", expoArgs, {
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

  // Préférer le script dans le projet hôte pour que Storybook (buildIndex) résolve les presets depuis le projet
  const compareScriptInProject = path.join(
    PROJECT_ROOT,
    "node_modules",
    "@setshao",
    "visual-regression",
    "src",
    "scripts",
    "compare-visual-regressions.ts",
  );
  const compareScript = existsSync(compareScriptInProject)
    ? compareScriptInProject
    : path.join(SCRIPT_DIR, "compare-visual-regressions.ts");
  log("blue", "🔍", "Lancement de la comparaison initiale");

  const compareEnv = { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT, VR_RUN_COMPARE: "1" };
  const tsxCli = getTsxCliPath(PACKAGE_ROOT, PROJECT_ROOT);
  const { command: compareCommand, args: compareArgs } = getNodeTsxArgs(compareScript);
  if (tsxCli !== null) {
    log("blue", "📌", "Script comparaison: node + tsx (stdio direct)");
  } else {
    log("yellow", "📌", "Script comparaison: npx tsx (fallback)");
  }
  const compare =
    tsxCli !== null
      ? spawn("node", [tsxCli, compareScript], {
          stdio: "inherit",
          cwd: PROJECT_ROOT,
          env: compareEnv,
          shell: false,
        })
      : spawn(compareCommand, compareArgs, {
          stdio: "inherit",
          cwd: PROJECT_ROOT,
          env: compareEnv,
          ...spawnShellOption,
        });

  compare.on("close", async code => {
    if (code === 0) {
      log("green", "✅", "Comparaison initiale terminée");
      try {
        const res = await fetch(`${VR_SERVER_URL}/regressions/rebuild`, { method: "POST" });
        if (res.ok) {
          const body = (await res.json()) as { diffCount?: number; newCount?: number };
          const diffs = body.diffCount ?? 0;
          const news = body.newCount ?? 0;
          log("blue", "🔄", `Index des régressions reconstruit: ${diffs} diff(s), ${news} nouveau(x) screenshot(s)`);
        }
      } catch {
        // ignore
      }
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
