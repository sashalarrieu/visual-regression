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
  VR_SERVER_PORT,
  VR_SERVER_URL,
} from "@constants/constants";
import {
  assertVrConfig,
  getNodeTsxArgs,
  getProjectRoot,
  getScriptDir,
  getTsxCliPath,
  resolveVrConfig,
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
        const portPattern = new RegExp(`:${port}(\\s|$)`);
        const lines = out.split("\n").filter(l => portPattern.test(l.trim()));
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

const runShellCommand = (command: string, args: string[], cwd: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      cwd,
      env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT },
    });
    proc.on("error", reject);
    proc.on("close", code => resolve(code ?? 1));
  });

const parseStorybookPort = (storybookUrl: string): number => {
  try {
    const port = new URL(storybookUrl).port;
    return port ? Number(port) : STORYBOOK_PORT;
  } catch {
    return STORYBOOK_PORT;
  }
};

const needsStaticStorybookBuild = (statsRelativePath: string): boolean => {
  if (process.env.VR_STORYBOOK_STATIC_REBUILD === "1") return true;
  const staticDir = path.join(PROJECT_ROOT, "storybook-static");
  return !existsSync(path.join(staticDir, "index.html")) || !existsSync(path.join(PROJECT_ROOT, statsRelativePath));
};

const main = async () => {
  assertVrConfig(PROJECT_ROOT);
  const vrConfig = resolveVrConfig(PROJECT_ROOT);
  const storybookUrl = vrConfig.storybook.url;
  const storybookPort = parseStorybookPort(storybookUrl);
  const useStaticStorybook = vrConfig.launcher.storybookStatic;

  log("blue", "🚀", "Démarrage de l'environnement Visual Regressions");

  log("blue", "📋", "Vérification des ports");

  const expoAvailable = await isPortAvailable(EXPO_PORT);
  const vrServerAvailable = await isPortAvailable(VR_SERVER_PORT);
  const storybookAvailable = await isPortAvailable(storybookPort);

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
    const storiesIndexed = await waitForStorybookStories(1, 3, PROJECT_ROOT);
    if (storiesIndexed) {
      storybookAlreadyRunning = true;
    } else {
      log("yellow", "⚠️", `Port ${storybookPort} occupé mais index Storybook vide — redémarrage`);
      killPort(storybookPort);
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
  } else if (useStaticStorybook) {
    log("blue", "📚", "Storybook statique (build + serve)");

    if (needsStaticStorybookBuild(vrConfig.compare.statsFile)) {
      log("blue", "🔨", "Build Storybook (--stats-json)…");
      const buildCode = await runShellCommand("yarn", ["storybook:build:stats"], PROJECT_ROOT);
      if (buildCode !== 0) {
        log("red", "❌", "Échec du build Storybook statique");
        vrServer.kill();
        process.exit(1);
      }
    } else {
      log(
        "blue",
        "⏭️",
        "Build Storybook ignoré (storybook-static/ à jour — VR_STORYBOOK_STATIC_REBUILD=1 pour forcer)",
      );
    }

    storybook = spawn("npx", ["serve", "storybook-static", "-l", String(storybookPort)], {
      stdio: "inherit",
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, STORYBOOK_ENV: "web" },
    });

    storybook.on("error", err => {
      log("red", "❌", `Erreur serveur Storybook statique: ${err.message}`);
      vrServer.kill();
      process.exit(1);
    });

    const storybookReady = await waitForServer(storybookPort, 60);
    if (!storybookReady) {
      log("red", "❌", "Storybook statique n'a pas démarré à temps");
      vrServer.kill();
      process.exit(1);
    }

    const storiesIndexed = await waitForStorybookStories(1, 90, PROJECT_ROOT);
    if (!storiesIndexed) {
      log("red", "❌", "Storybook statique n'a pas indexé les stories à temps");
      vrServer.kill();
      if (storybook) storybook.kill();
      process.exit(1);
    }

    log("green", "✅", "Storybook statique prêt");
  } else {
    log("blue", "📚", "Démarrage de Storybook (dev)");

    storybook = spawn("cross-env", ["STORYBOOK_ENV=web", "storybook", "dev", "-p", String(storybookPort)], {
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

    const storybookReady = await waitForServer(storybookPort, 60);
    if (!storybookReady) {
      log("red", "❌", "Storybook n'a pas démarré à temps");
      vrServer.kill();
      process.exit(1);
    }

    const storiesIndexed = await waitForStorybookStories(1, 90, PROJECT_ROOT);
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

  const launcherConfig = vrConfig.launcher;

  const rebuildIndex = async (): Promise<void> => {
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
  };

  const printReadyMessage = (): void => {
    log("green", "🎉", "Environnement VR prêt !");
    log("blue", "🌐", `Interface VR disponible sur ${EXPO_URL}`);
    log("blue", "🔧", `Serveur VR API sur ${VR_SERVER_URL}`);
    log("blue", "📚", `Storybook disponible sur ${storybookUrl}`);
  };

  const runInitialCompareJob = (): Promise<number> => {
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
    log("blue", "🔍", "Comparaison initiale (incrémentale)…");

    const compareEnv = { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT, VR_RUN_COMPARE: "1" };
    const tsxCli = getTsxCliPath(PACKAGE_ROOT, PROJECT_ROOT);
    const { command: compareCommand, args: compareArgs } = getNodeTsxArgs(compareScript);
    if (tsxCli !== null) {
      log("blue", "📌", "Script comparaison: node + tsx (stdio direct)");
    } else {
      log("yellow", "📌", "Script comparaison: npx tsx (fallback)");
    }

    return new Promise((resolve, reject) => {
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

      compare.on("error", err => reject(err));
      compare.on("close", code => resolve(code ?? 1));
    });
  };

  // Compare avant Expo : évite que Metro surveille public/Screenshots pendant les captures
  if (!launcherConfig.runInitialCompare) {
    log("blue", "⏭️", "Comparaison initiale ignorée (launcher.runInitialCompare: false ou VR_RUN_INITIAL_COMPARE=0)");
  } else {
    try {
      const code = await runInitialCompareJob();
      if (code === 0) {
        log("green", "✅", "Comparaison initiale terminée");
      } else {
        log("yellow", "⚠️", `Comparaison terminée avec le code ${code}`);
      }
    } catch (err) {
      log("red", "❌", `Erreur comparaison initiale: ${err instanceof Error ? err.message : String(err)}`);
    }
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
  await rebuildIndex();
  printReadyMessage();

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
