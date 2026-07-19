// scripts/vr-launcher.ts (package @setshao/visual-regression)
import type { ChildProcess } from "child_process";
import { spawn, spawnSync } from "child_process";
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
} from "../constants/constants";
import {
  assertVrConfig,
  getNodeTsxArgs,
  getPackageCliTsconfigPath,
  getProjectRoot,
  getScriptDir,
  getTsxCliPath,
  resolvePackageInstallRoot,
  resolveVrConfig,
  spawnShellOption,
  TSX_TSCONFIG_ENV,
  waitForStorybookHostReady,
  waitForStorybookStories,
} from "../utils/node";
import { getCaptureBackend, getCaptureDaemonUrl } from "../utils/vr-capture-backend";
import {
  fetchCaptureDaemonHealth,
  isCaptureDaemonReusableForProject,
  waitForCaptureDaemon,
} from "../utils/vr-capture-remote";
import {
  composeDown,
  composeDownSync,
  composeUp,
  dumpComposeLogs,
  followComposeLogs,
  isDockerCliAvailable,
  isDockerDaemonRunning,
  stopComposeLogs,
} from "../utils/vr-docker";
import { getExpoSpawnEnv } from "../utils/vr-expo-env";
import {
  getStorybookMode,
  resolveStorybookModeForCapture,
  startStorybook,
  stopStorybook,
  usesNextJsViteStorybook,
} from "../utils/vr-storybook-runtime";

const SCRIPT_DIR = getScriptDir(import.meta);
const PACKAGE_ROOT = path.join(SCRIPT_DIR, "..", "..");
const EXPO_ROOT = resolvePackageInstallRoot(getProjectRoot(), PACKAGE_ROOT);
const PACKAGE_TSCONFIG = getPackageCliTsconfigPath(PACKAGE_ROOT);
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

/** Une seule ouverture par URL et par session `yarn vr`. */
const openedBrowserUrls = new Set<string>();
const openInBrowserOnce = (url: string): void => {
  if (openedBrowserUrls.has(url)) return;
  openedBrowserUrls.add(url);
  openInBrowser(url);
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

/** Tue un processus et ses enfants (nécessaire sous Windows quand Expo tourne via shell). */
const killProcessTree = (proc: ChildProcess | null | undefined): void => {
  if (!proc || proc.killed || proc.pid == null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
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

const LOCAL_CAPTURE_HINT =
  'Capture locale uniquement si configurée : capture.backend: "local" dans vr.config.cjs (ou VR_CAPTURE_BACKEND=local).';

const main = async () => {
  assertVrConfig(PROJECT_ROOT);
  const vrConfig = resolveVrConfig(PROJECT_ROOT);
  const captureBackend = getCaptureBackend(vrConfig);
  const useLocalCapture = captureBackend === "local";
  const storybookUrl = vrConfig.storybook.url;
  const storybookPort = parseStorybookPort(storybookUrl);
  const explicitStorybookMode = vrConfig.launcher.storybookMode;

  log("blue", "🚀", "Démarrage de l'environnement Visual Regressions");

  log("blue", "📋", "Vérification des ports");

  const expoAvailable = await isPortAvailable(EXPO_PORT);
  const vrServerAvailable = await isPortAvailable(VR_SERVER_PORT);
  const storybookAvailable = await isPortAvailable(storybookPort);
  /** Storybook déjà servi au démarrage → ne pas rouvrir l'onglet (sauf sidecar recréé). */
  const storybookWasUpAtStart = !storybookAvailable;
  let shouldOpenStorybookInBrowser = !storybookWasUpAtStart;

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

  // Storybook et daemon : ports hôte dérivés (ou override config) — ne pas killPort ici.
  const daemonPort = parseStorybookPort(vrConfig.capture.daemonUrl);
  const daemonAvailable = await isPortAvailable(daemonPort);
  let localStorybookProcess: ChildProcess | null = null;
  let dockerLogsProcess: ChildProcess | null = null;
  let useDockerSidecar = !useLocalCapture;

  log("blue", "🔧", "Démarrage du serveur VR");

  const vrServerScript = path.join(SCRIPT_DIR, "vr-server.ts");
  const tsxCli = getTsxCliPath(PACKAGE_ROOT, PROJECT_ROOT);
  const { command: nodeTsxCommand, args: nodeTsxArgs } = getNodeTsxArgs(vrServerScript);
  const vrServer =
    tsxCli !== null
      ? spawn("node", [tsxCli, vrServerScript], {
          stdio: "inherit",
          cwd: PROJECT_ROOT,
          env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT, [TSX_TSCONFIG_ENV]: PACKAGE_TSCONFIG },
          shell: false,
        })
      : spawn(nodeTsxCommand, nodeTsxArgs, {
          stdio: "inherit",
          cwd: PROJECT_ROOT,
          env: { ...process.env, VR_PROJECT_ROOT: PROJECT_ROOT, [TSX_TSCONFIG_ENV]: PACKAGE_TSCONFIG },
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

  let compareProcess: ChildProcess | null = null;

  const cleanupOnFatal = (): void => {
    killProcessTree(compareProcess);
    killProcessTree(expo);
    killProcessTree(vrServer);
    stopStorybook(localStorybookProcess);
    stopComposeLogs(dockerLogsProcess);
    if (useDockerSidecar) {
      composeDownSync(PROJECT_ROOT);
    }
  };

  const abortVr = (reason: string, detail?: string): never => {
    log("red", "❌", reason);
    if (detail) {
      log("yellow", "⚠️", detail);
    }
    log("yellow", "ℹ️", LOCAL_CAPTURE_HINT);
    cleanupOnFatal();
    process.exit(1);
  };

  // Interface VR dès que le serveur API est prêt (en parallèle du sidecar / captures).
  log("blue", "📱", "Démarrage de l'interface VR (Expo depuis le package)");
  const expoArgs = ["expo", "start", "--web", "--port", String(EXPO_PORT)];
  if (process.env.VR_CLEAR_METRO === "1") {
    expoArgs.push("--clear");
  }

  const npxRunner = process.platform === "win32" ? "npx.cmd" : "npx";
  const expo = spawn(npxRunner, expoArgs, {
    stdio: "inherit",
    cwd: EXPO_ROOT,
    env: getExpoSpawnEnv(process.env, PROJECT_ROOT),
    ...spawnShellOption,
  });

  const expoReadyPromise = waitForServer(EXPO_PORT, 60);

  expo.on("error", err => {
    log("red", "❌", `Erreur Expo: ${err.message}`);
    cleanupOnFatal();
    process.exit(1);
  });

  const startLocalCapture = async (): Promise<void> => {
    stopComposeLogs(dockerLogsProcess);
    dockerLogsProcess = null;
    useDockerSidecar = false;
    process.env.VR_CAPTURE_BACKEND = "local";
    log("blue", "📚", "Capture locale (Storybook + Playwright sur l'hôte)");
    log(
      "yellow",
      "⚠️",
      "Rendu non reproductible : fort risque de diffs vs baseline Docker/CI (polices, OS, GPU). Ne pas valider comme référence.",
    );
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

  const startDockerLogFollow = (): void => {
    if (!useDockerSidecar || !vrConfig.docker.showLogs || dockerLogsProcess) return;
    log("blue", "📜", "Suivi des logs Docker dans ce terminal (docker.showLogs / VR_DOCKER_SHOW_LOGS)");
    dockerLogsProcess = followComposeLogs(PROJECT_ROOT);
    dockerLogsProcess.on("error", err => {
      log("yellow", "⚠️", `Impossible de suivre les logs Docker: ${err.message}`);
    });
  };

  const restartDockerLogFollow = (): void => {
    stopComposeLogs(dockerLogsProcess);
    dockerLogsProcess = null;
    startDockerLogFollow();
  };

  // --- Capture : Docker (défaut) ou locale si capture.backend === "local" ---
  if (useLocalCapture) {
    await startLocalCapture();
    shouldOpenStorybookInBrowser = true;
  } else if (!isDockerDaemonRunning()) {
    abortVr(
      isDockerCliAvailable()
        ? "Docker Desktop est installé mais le daemon n'est pas démarré."
        : "Docker n'est pas disponible sur cette machine.",
      "La VR exige Docker pour la capture (sidecar Storybook + Playwright).",
    );
  } else {
    // Le conteneur choisit son mode Storybook via VR_STORYBOOK_MODE.
    const captureStorybookMode = resolveStorybookModeForCapture(PROJECT_ROOT);
    if (captureStorybookMode === "static") {
      process.env.VR_STORYBOOK_MODE = "static";
    }
    if (
      explicitStorybookMode !== "static" &&
      captureStorybookMode === "static" &&
      usesNextJsViteStorybook(PROJECT_ROOT)
    ) {
      log(
        "yellow",
        "ℹ️",
        "Storybook statique activé dans Docker (@storybook/nextjs-vite — le mode dev ne rend pas les stories en capture headless)",
      );
    }

    // Réutiliser un sidecar déjà sain pour *ce* projet (ports dérivés).
    // Les sidecars des autres projets restent intacts (ports / Compose distincts).
    const thisProjectPortsBusy = !storybookAvailable || !daemonAvailable;
    const existingHealth = thisProjectPortsBusy ? await fetchCaptureDaemonHealth() : null;
    const canReuseSidecar = isCaptureDaemonReusableForProject(existingHealth, PROJECT_ROOT);

    if (canReuseSidecar) {
      log(
        "green",
        "✅",
        `Sidecar de capture déjà actif — réutilisation (${getCaptureDaemonUrl()} → Storybook ${storybookUrl})`,
      );
      shouldOpenStorybookInBrowser = false;
      startDockerLogFollow();
    } else {
      shouldOpenStorybookInBrowser = true;
      if (thisProjectPortsBusy) {
        if (existingHealth?.ready && existingHealth.hostProjectRoot) {
          log(
            "yellow",
            "⚠️",
            `Ports ${storybookPort}/${daemonPort} occupés par un sidecar inattendu — recréation de *ce* stack`,
          );
        } else {
          log("yellow", "⚠️", `Port ${storybookPort}/${daemonPort} occupé par un sidecar non sain — recréation`);
        }
        stopComposeLogs(dockerLogsProcess);
        dockerLogsProcess = null;
        await composeDown(PROJECT_ROOT).catch(() => undefined);
        killPort(storybookPort);
        killPort(daemonPort);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      log(
        "blue",
        "🐳",
        `Démarrage du sidecar de capture (Docker) — Storybook :${storybookPort}, daemon :${daemonPort}`,
      );
      let composeCode = await composeUp(PROJECT_ROOT);
      if (composeCode !== 0) {
        log(
          "yellow",
          "⚠️",
          `docker compose up a échoué (code ${composeCode}) — tentative de libération des ports ${storybookPort}/${daemonPort}`,
        );
        log(
          "yellow",
          "ℹ️",
          "En cas de collision de ports, fixez storybook.url / capture.daemonUrl dans vr.config.cjs (ou VR_STORYBOOK_URL / VR_CAPTURE_DAEMON_URL).",
        );
        killPort(storybookPort);
        killPort(daemonPort);
        await new Promise(resolve => setTimeout(resolve, process.platform === "win32" ? 3500 : 2000));
        composeCode = await composeUp(PROJECT_ROOT);
      }

      if (composeCode !== 0) {
        log("yellow", "📜", "Derniers logs Docker :");
        dumpComposeLogs(PROJECT_ROOT);
        abortVr(
          `docker compose up a échoué (code ${composeCode}).`,
          "Vérifiez Docker Desktop, les ports Storybook/daemon et vr.config.cjs (storybook.url / capture.daemonUrl).",
        );
      } else {
        restartDockerLogFollow();
        log("blue", "⏳", "Attente du daemon de capture (Storybook + Playwright — le 1er build peut être long)");
        let daemonReady = await waitForCaptureDaemon(300);
        if (!daemonReady) {
          log("yellow", "⚠️", "Daemon non prêt après démarrage — rebuild forcé du sidecar");
          if (!vrConfig.docker.showLogs) {
            log("yellow", "📜", "Derniers logs Docker :");
            dumpComposeLogs(PROJECT_ROOT);
          }
          stopComposeLogs(dockerLogsProcess);
          dockerLogsProcess = null;
          await composeDown(PROJECT_ROOT).catch(() => undefined);
          const rebuildCode = await composeUp(PROJECT_ROOT, true);
          if (rebuildCode === 0) {
            restartDockerLogFollow();
            log("blue", "⏳", "Attente du daemon après rebuild forcé");
            daemonReady = await waitForCaptureDaemon(300);
          }
          if (!daemonReady) {
            if (!vrConfig.docker.showLogs) {
              log("yellow", "📜", "Derniers logs Docker :");
              dumpComposeLogs(PROJECT_ROOT);
            }
            stopComposeLogs(dockerLogsProcess);
            dockerLogsProcess = null;
            await composeDown(PROJECT_ROOT).catch(() => undefined);
            abortVr("Daemon de capture injoignable après démarrage du sidecar Docker.");
          }
        }
        if (useDockerSidecar) {
          log("green", "✅", `Daemon de capture prêt (${getCaptureDaemonUrl()})`);
        }
      }
    }
  }

  // Storybook est forwardé depuis le conteneur : vérifier qu'il répond côté hôte (pas seulement dans Docker).
  if (useDockerSidecar) {
    log("blue", "⏳", `Attente du forward Storybook sur ${storybookUrl} (1er build Vite possible)`);
    const hostReady = await waitForStorybookHostReady(1, 180, PROJECT_ROOT);
    if (hostReady.ready) {
      log("green", "✅", `Storybook accessible sur ${storybookUrl} (${hostReady.storyCount} story/stories indexée(s))`);
    } else {
      throw new Error(
        `Storybook inaccessible sur ${storybookUrl} depuis l'hôte après 180 s ` +
          `(dernier décompte: ${hostReady.storyCount} story). ` +
          `Vérifiez Docker Desktop et le mapping Storybook (${storybookUrl}).`,
      );
    }
  } else {
    const storiesIndexed = await waitForStorybookStories(1, 60, PROJECT_ROOT);
    if (storiesIndexed) {
      log("green", "✅", `Storybook prêt (${storybookUrl})`);
    } else {
      log("yellow", "⚠️", "Storybook local pas encore indexé — la capture peut patienter");
    }
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
      log("yellow", "ℹ️", "Capture locale (capture.backend: local) — Docker non utilisé pour cette session");
    }
    openInBrowserOnce(EXPO_URL);
    if (shouldOpenStorybookInBrowser) {
      openInBrowserOnce(storybookUrl);
    }
  };

  const spawnInitialCompare = (): ChildProcess => {
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
    log("blue", "🔍", "Comparaison initiale (incrémentale) en arrière-plan…");

    const compareEnv = {
      ...process.env,
      VR_PROJECT_ROOT: PROJECT_ROOT,
      VR_RUN_COMPARE: "1",
      VR_CAPTURE_BACKEND: useDockerSidecar ? "docker" : process.env.VR_CAPTURE_BACKEND || "local",
      [TSX_TSCONFIG_ENV]: PACKAGE_TSCONFIG,
    };
    const tsxCli = getTsxCliPath(PACKAGE_ROOT, PROJECT_ROOT);
    const { command: compareCommand, args: compareArgs } = getNodeTsxArgs(compareScript);
    if (tsxCli !== null) {
      log("blue", "📌", "Script comparaison: node + tsx (stdio direct)");
    } else {
      log("yellow", "📌", "Script comparaison: npx tsx (fallback)");
    }

    return tsxCli !== null
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
  };

  // Expo en parallèle des captures : Metro ignore public/Screenshots (metro.config.cjs blockList).
  if (!launcherConfig.runInitialCompare) {
    log("blue", "⏭️", "Comparaison initiale ignorée (launcher.runInitialCompare: false ou VR_RUN_INITIAL_COMPARE=0)");
  } else {
    compareProcess = spawnInitialCompare();
    compareProcess.on("error", err => {
      log("red", "❌", `Erreur comparaison initiale: ${err.message}`);
    });
    compareProcess.on("close", code => {
      compareProcess = null;
      if (code === 0) {
        log("green", "✅", "Comparaison initiale terminée");
      } else {
        log("yellow", "⚠️", `Comparaison terminée avec le code ${code}`);
      }
      void rebuildIndex();
    });
  }

  const expoReady = await expoReadyPromise;
  if (!expoReady) {
    log("red", "❌", "Expo n'a pas démarré à temps");
    cleanupOnFatal();
    process.exit(1);
  }

  log("green", "✅", "Expo prêt");
  if (compareProcess) {
    log("blue", "ℹ️", "Interface VR ouverte — les captures continuent en arrière-plan (mise à jour via SSE)");
  }
  await rebuildIndex();
  printReadyMessage();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("yellow", "⚠️", `Arrêt en cours (${signal})`);
    killProcessTree(compareProcess);
    killProcessTree(expo);
    killProcessTree(vrServer);
    stopStorybook(localStorybookProcess);
    stopComposeLogs(dockerLogsProcess);
    if (useDockerSidecar) {
      const downCode = composeDownSync(PROJECT_ROOT);
      if (downCode !== 0) {
        log("yellow", "⚠️", `docker compose down a retourné le code ${downCode}`);
      } else {
        log("green", "🐳", "Sidecar Docker arrêté");
      }
    }
    process.exit(0);
  };

  // Ctrl+C tue souvent Expo en premier sous Windows : le handler "close" assure l'arrêt du sidecar.
  expo.on("close", () => shutdown("expo-close"));

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // SIGHUP (fermeture du terminal / session SSH) : arrêt propre du sidecar aussi.
  // Absent sous Windows — le listener est simplement ignoré par le runtime.
  process.on("SIGHUP", () => shutdown("SIGHUP"));
  if (process.platform === "win32") {
    process.on("SIGBREAK", () => shutdown("SIGBREAK"));
  }
};

main().catch(err => {
  log("red", "❌", `Erreur fatale: ${err.message}`);
  process.exit(1);
});
