// scripts/vr-launcher.ts (package @setshao/visual-regression)
import type { ChildProcess } from "child_process";
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
} from "../constants/constants";
import {
  assertVrConfig,
  getNodeTsxArgs,
  getProjectRoot,
  getScriptDir,
  getTsxCliPath,
  resolveVrConfig,
  spawnShellOption,
  waitForStorybookStories,
} from "../utils/node";
import { getCaptureDaemonUrl } from "../utils/vr-capture-backend";
import { waitForCaptureDaemon } from "../utils/vr-capture-remote";
import { composeDown, composeUp, isDockerAvailable } from "../utils/vr-docker";
import { getExpoSpawnEnv } from "../utils/vr-expo-env";
import { getStorybookMode, startStorybook, stopStorybook } from "../utils/vr-storybook-runtime";

const SCRIPT_DIR = getScriptDir(import.meta);
const PACKAGE_ROOT = path.join(SCRIPT_DIR, "..", "..");
const PROJECT_ROOT = getProjectRoot();

const log = (color: keyof typeof LOG_COLORS, prefix: string, message: string) => {
  console.log(`${LOG_COLORS[color]}${prefix}${LOG_COLORS.reset} ${message}`);
};

const openInBrowser = (url: string): void => {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? { cmd: "open", args: [url] }
      : platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", url] }
        : { cmd: "xdg-open", args: [url] };

  const child = spawn(command.cmd, command.args, {
    stdio: "ignore",
    detached: true,
    shell: false,
  });
  child.on("error", () => {
    log("yellow", "⚠️", `Ouverture automatique impossible (${url})`);
  });
  child.unref();
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
        const portPattern = new RegExp(`:${port}$`);
        const lines = out
          .split("\n")
          .map(l => l.trim())
          .filter(line => line.startsWith("TCP") || line.startsWith("UDP"));
        const pids = new Set<string>();
        for (const line of lines) {
          const cols = line.split(/\s+/);
          // netstat -ano (Windows):
          // TCP <local_addr> <foreign_addr> <state> <pid>
          // UDP <local_addr> *:* <pid>
          const proto = cols[0];
          const isTcp = proto === "TCP";
          const localAddress = cols[1] ?? "";
          const foreignAddress = isTcp ? (cols[2] ?? "") : "";
          const state = isTcp ? (cols[3] ?? "") : "";
          const pid = cols[cols.length - 1];

          // Windows peut localiser l'état TCP (ex: "ÉCOUTE"), donc on ne dépend
          // pas uniquement de "LISTENING". Le couple foreign "*:0"/"0.0.0.0:0"
          // correspond à un socket en écoute.
          const hasListeningForeignAddress =
            foreignAddress === "0.0.0.0:0" || foreignAddress === "[::]:0" || foreignAddress === "*:*";
          const isListening = !isTcp || state === "LISTENING" || hasListeningForeignAddress;
          if (!portPattern.test(localAddress) || !isListening) {
            continue;
          }

          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            const numericPid = Number(pid);
            if (numericPid !== process.pid && numericPid !== process.ppid) {
              pids.add(pid);
            }
          }
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
      const pids = data
        .toString()
        .split(/\r?\n/)
        .map(v => v.trim())
        .filter(v => /^\d+$/.test(v))
        .filter(v => Number(v) !== process.pid && Number(v) !== process.ppid);

      for (const pid of pids) {
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
  let localStorybookProcess: ChildProcess | null = null;
  let useDockerSidecar = true;
  const allowExplicitLocalCaptureFallback =
    (process.env.VR_CAPTURE_BACKEND || "").toLowerCase() === "local" || process.env.VR_FORCE_LOCAL_CAPTURE === "1";

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

  const startLocalCaptureFallback = async (reason: string): Promise<void> => {
    if (!allowExplicitLocalCaptureFallback) {
      throw new Error(
        `${reason}. Docker est obligatoire par défaut pour 'yarn vr'. ` +
          "Pour désactiver Docker explicitement: VR_CAPTURE_BACKEND=local yarn vr " +
          "(ou VR_FORCE_LOCAL_CAPTURE=1 yarn vr).",
      );
    }
    useDockerSidecar = false;
    process.env.VR_CAPTURE_BACKEND = "local";
    log("yellow", "⚠️", `Mode fallback local activé: ${reason}`);
    const mode = getStorybookMode();
    const storybook = await startStorybook({
      projectRoot: PROJECT_ROOT,
      port: storybookPort,
      mode,
      waitMaxAttempts: 120,
    });
    localStorybookProcess = storybook.process;
    if (!storybook.ready) {
      throw new Error(`Storybook local non prêt sur ${storybookUrl}`);
    }
    log("green", "✅", `Storybook local prêt (${storybookUrl}, mode=${storybook.mode})`);
  };

  // --- Sidecar Docker de capture (Storybook + daemon Playwright) ---
  if (!isDockerAvailable()) {
    await startLocalCaptureFallback("Docker indisponible");
  } else {
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
      let composeCode = await composeUp(PROJECT_ROOT);
      if (composeCode !== 0) {
        log(
          "yellow",
          "⚠️",
          `docker compose up a échoué (code ${composeCode}) — tentative de libération des ports ${storybookPort}/${CAPTURE_DAEMON_PORT}`,
        );
        killPort(storybookPort);
        killPort(CAPTURE_DAEMON_PORT);
        await new Promise(resolve => setTimeout(resolve, process.platform === "win32" ? 3500 : 2000));
        composeCode = await composeUp(PROJECT_ROOT);
      }

      if (composeCode !== 0) {
        await startLocalCaptureFallback(`docker compose up a échoué (code ${composeCode})`);
      } else {
        log("blue", "⏳", "Attente du daemon de capture (Storybook + Playwright — le 1er build peut être long)");
        let daemonReady = await waitForCaptureDaemon(300);
        if (!daemonReady) {
          log("yellow", "⚠️", "Daemon non prêt après démarrage — rebuild forcé du sidecar");
          await composeDown(PROJECT_ROOT).catch(() => undefined);
          const rebuildCode = await composeUp(PROJECT_ROOT, true);
          if (rebuildCode === 0) {
            log("blue", "⏳", "Attente du daemon après rebuild forcé");
            daemonReady = await waitForCaptureDaemon(300);
          }
          if (!daemonReady) {
            await composeDown(PROJECT_ROOT).catch(() => undefined);
            await startLocalCaptureFallback("daemon de capture injoignable");
          }
        }
        log("green", "✅", `Sidecar de capture prêt (${getCaptureDaemonUrl()})`);
      }
    }
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
    if (useDockerSidecar) {
      log("blue", "📚", `Storybook (conteneur) disponible sur ${storybookUrl}`);
      log("blue", "🐳", `Daemon de capture sur ${getCaptureDaemonUrl()}`);
    } else {
      log("blue", "📚", `Storybook (local) disponible sur ${storybookUrl}`);
      log("yellow", "⚠️", "Capture locale active (fallback) : Docker non utilisé pour cette session");
    }
    openInBrowser(storybookUrl);
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
    env: getExpoSpawnEnv(process.env, PROJECT_ROOT),
  });

  expo.on("error", err => {
    log("red", "❌", `Erreur Expo: ${err.message}`);
    vrServer.kill();
    stopStorybook(localStorybookProcess);
    if (useDockerSidecar) {
      void composeDown(PROJECT_ROOT);
    }
    process.exit(1);
  });

  const expoReady = await waitForServer(EXPO_PORT, 60);
  if (!expoReady) {
    log("red", "❌", "Expo n'a pas démarré à temps");
    vrServer.kill();
    stopStorybook(localStorybookProcess);
    if (useDockerSidecar) {
      void composeDown(PROJECT_ROOT);
    }
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
    stopStorybook(localStorybookProcess);
    try {
      if (useDockerSidecar) {
        await composeDown(PROJECT_ROOT);
      }
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
