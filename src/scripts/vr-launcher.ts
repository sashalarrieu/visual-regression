// scripts/vr-launcher.ts (package @setshao/visual-regression)
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

import {
  CAPTURE_DAEMON_PORT,
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
import { getCaptureDaemonUrl } from "@utils/vr-capture-backend";
import { waitForCaptureDaemon } from "@utils/vr-capture-remote";
import { composeDown, composeUp, isDockerAvailable } from "@utils/vr-docker";

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

const parseStorybookPort = (storybookUrl: string): number => {
  try {
    const port = new URL(storybookUrl).port;
    return port ? Number(port) : STORYBOOK_PORT;
  } catch {
    return STORYBOOK_PORT;
  }
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

  // Storybook et Playwright tournent dans le sidecar Docker (ports 6006 + 2810 forwardés).
  // Le nettoyage/réutilisation du sidecar est géré plus bas via un test de santé du daemon
  // (ne PAS killPort ces ports → tuerait le proxy Docker).
  const daemonAvailable = await isPortAvailable(CAPTURE_DAEMON_PORT);

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

  // --- Sidecar Docker de capture (Storybook + daemon Playwright) ---
  if (!isDockerAvailable()) {
    log("red", "❌", "Docker est requis pour la capture VR mais n'est pas disponible.");
    log("yellow", "💡", "Installez Docker Desktop puis relancez. Toutes les captures s'exécutent dans le conteneur.");
    vrServer.kill();
    process.exit(1);
  }

  // Le conteneur choisit son mode Storybook via VR_STORYBOOK_MODE.
  if (useStaticStorybook || process.env.VR_STORYBOOK_STATIC === "1") {
    process.env.VR_STORYBOOK_MODE = "static";
  }

  // Réutiliser un sidecar déjà sain → redémarrage de `yarn vr` rapide et fiable
  // (Storybook prend les changements de code via HMR sur le bind mount, pas besoin
  // de recréer le conteneur). On ne recrée que si le sidecar est absent ou cassé.
  const sidecarBusy = !storybookAvailable || !daemonAvailable;
  const existingDaemonHealthy = sidecarBusy ? await waitForCaptureDaemon(1) : false;

  if (existingDaemonHealthy) {
    log("green", "✅", `Sidecar de capture déjà actif — réutilisation (${getCaptureDaemonUrl()})`);
  } else {
    if (sidecarBusy) {
      log("yellow", "⚠️", `Port ${storybookPort}/${CAPTURE_DAEMON_PORT} occupé par un sidecar non sain — recréation`);
      await composeDown(PROJECT_ROOT).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    log("blue", "🐳", "Démarrage du sidecar de capture (Docker)");
    const composeCode = await composeUp(PROJECT_ROOT);
    if (composeCode !== 0) {
      log("red", "❌", `docker compose up a échoué (code ${composeCode})`);
      vrServer.kill();
      process.exit(1);
    }

    log("blue", "⏳", "Attente du daemon de capture (Storybook + Playwright — le 1er build peut être long)");
    const daemonReady = await waitForCaptureDaemon(300);
    if (!daemonReady) {
      log("red", "❌", `Daemon de capture injoignable sur ${getCaptureDaemonUrl()}`);
      await composeDown(PROJECT_ROOT).catch(() => undefined);
      vrServer.kill();
      process.exit(1);
    }
    log("green", "✅", `Sidecar de capture prêt (${getCaptureDaemonUrl()})`);
  }

  // Storybook est forwardé depuis le conteneur : vérifier qu'il répond côté hôte.
  const storiesIndexed = await waitForStorybookStories(1, 60, PROJECT_ROOT);
  if (storiesIndexed) {
    log("green", "✅", `Storybook prêt (forwardé sur ${storybookUrl})`);
  } else {
    log("yellow", "⚠️", "Storybook du conteneur pas encore indexé côté hôte — la capture peut patienter");
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
    log("blue", "📚", `Storybook (conteneur) disponible sur ${storybookUrl}`);
    log("blue", "🐳", `Daemon de capture sur ${getCaptureDaemonUrl()}`);
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
    void composeDown(PROJECT_ROOT);
    process.exit(1);
  });

  const expoReady = await waitForServer(EXPO_PORT, 60);
  if (!expoReady) {
    log("red", "❌", "Expo n'a pas démarré à temps");
    vrServer.kill();
    void composeDown(PROJECT_ROOT);
    process.exit(1);
  }

  log("green", "✅", "Expo prêt");
  await rebuildIndex();
  printReadyMessage();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("yellow", "⚠️", `Arrêt en cours (${signal})`);
    expo.kill();
    vrServer.kill();
    try {
      await composeDown(PROJECT_ROOT);
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // SIGHUP (fermeture du terminal / session SSH) : arrêt propre du sidecar aussi.
  // Absent sous Windows — le listener est simplement ignoré par le runtime.
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
};

main().catch(err => {
  log("red", "❌", `Erreur fatale: ${err.message}`);
  process.exit(1);
});
