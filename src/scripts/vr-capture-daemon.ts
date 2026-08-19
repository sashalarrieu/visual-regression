/**
 * Daemon de capture VR (sidecar Docker).
 *
 * Démarre Storybook (dev HMR ou statique selon VR_STORYBOOK_MODE) puis expose :
 *   - GET  /health              → { ready, mode, storybook, keepFresh, hostProjectRoot, composeProjectName }
 *   - POST /storybook/refresh   → resync sources (HMR nudge / rebuild static)
 *   - POST /capture/batch       → exécute runCaptureBatch localement et renvoie le résultat
 *
 * S'exécute *à l'intérieur* du conteneur (VR_DOCKER=1). Force le backend "local"
 * pour que runCaptureBatch effectue la vraie capture Playwright (pas de renvoi réseau).
 */
import type { ChildProcess } from "child_process";
import type { IncomingMessage, ServerResponse } from "http";
import { createServer } from "http";
import { format } from "util";

import { CAPTURE_DAEMON_PORT, STORYBOOK_PORT } from "../constants/constants";
import { getProjectRoot, resolveVrConfig } from "../utils/node";
import { resetStorybookIndexCache } from "../utils/vr-storybook-index";
import { nudgeFsWatchers, startStorybookKeepFresh } from "../utils/vr-storybook-keep-fresh";
import {
  ensureStaticStorybookFresh,
  getStorybookMode,
  startStorybook,
  stopStorybook,
  waitForDevStorybookIndexSettle,
} from "../utils/vr-storybook-runtime";

import type { CaptureBatchOptions, CaptureBatchResult, CaptureTask } from "./vr-capture-engine";
import { runCaptureBatch } from "./vr-capture-engine";

// Le backend est forcé "local" ici : runCaptureBatch effectue la vraie capture Playwright
// dans le conteneur (isDockerCaptureBackend() est lu à l'exécution, pas au chargement).
process.env.VR_CAPTURE_BACKEND = "local";

const PROJECT_ROOT = getProjectRoot();

const parseStorybookPort = (storybookUrl: string): number => {
  try {
    const port = new URL(storybookUrl).port;
    return port ? Number(port) : STORYBOOK_PORT;
  } catch {
    return STORYBOOK_PORT;
  }
};

const sendJson = (res: ServerResponse, data: unknown, status = 200): void => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

/** Sérialise les batches pour éviter la contention du pool Playwright. */
let captureChain: Promise<unknown> = Promise.resolve();
const runSerialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = captureChain.then(fn, fn);
  captureChain = next.catch(() => undefined);
  return next;
};

/** Rebuild / nudge Storybook : un seul à la fois (capture ∩ keep-fresh). */
let storybookSync: Promise<unknown> = Promise.resolve();
const withStorybookLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = storybookSync.then(fn, fn);
  storybookSync = next.catch(() => undefined);
  return next;
};

/**
 * Exécute le batch en capturant la sortie console (console.log/warn/error) pour
 * la renvoyer à l'hôte, tout en conservant l'affichage dans les logs du conteneur.
 * Sûr car les batches sont sérialisés (runSerialized) → pas de patch concurrent.
 */
const runCaptureWithConsole = async (
  tasks: CaptureTask[],
  options: CaptureBatchOptions,
): Promise<CaptureBatchResult> => {
  const consoleOutput: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const patch =
    (orig: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      consoleOutput.push(format(...args));
      orig(...args);
    };
  console.log = patch(original.log) as typeof console.log;
  console.warn = patch(original.warn) as typeof console.warn;
  console.error = patch(original.error) as typeof console.error;
  try {
    const result = await runCaptureBatch(tasks, options);
    return { ...result, consoleOutput };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
};

const main = async (): Promise<void> => {
  const config = resolveVrConfig(PROJECT_ROOT);
  const storybookPort = parseStorybookPort(config.storybook.url);
  const mode = getStorybookMode();

  console.log(`🐳 [vr-daemon] Démarrage (mode Storybook: ${mode}, projet: ${PROJECT_ROOT})`);

  // État partagé : /health répond dès maintenant (ready:false) pendant le build Storybook.
  let storybookReady = false;
  let storybookProcess: ChildProcess | null = null;
  let keepFresh: ReturnType<typeof startStorybookKeepFresh> | null = null;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://localhost:${CAPTURE_DAEMON_PORT}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, {
        ready: storybookReady,
        mode,
        storybook: storybookReady,
        keepFresh: true,
        hostProjectRoot: process.env.VR_HOST_PROJECT_ROOT || "",
        composeProjectName: process.env.VR_COMPOSE_PROJECT_NAME || "",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/storybook/refresh") {
      if (!storybookReady) {
        sendJson(res, { success: false, error: "Storybook pas encore prêt" }, 503);
        return;
      }
      try {
        const result = keepFresh ? await keepFresh.refresh() : { changed: false };
        sendJson(res, { success: true, ...result });
      } catch (err) {
        sendJson(res, { success: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/capture/batch") {
      if (!storybookReady) {
        sendJson(res, { success: false, error: "Storybook pas encore prêt" }, 503);
        return;
      }
      try {
        const body = JSON.parse(await readBody(req)) as {
          tasks: CaptureTask[];
          options: Omit<CaptureBatchOptions, "onProgress">;
        };
        const tasks = body?.tasks ?? [];
        const options = body?.options ?? { mode: "incremental" };

        if (!Array.isArray(tasks) || tasks.length === 0) {
          sendJson(res, { success: false, error: "tasks vide ou invalide" }, 400);
          return;
        }

        resetStorybookIndexCache(config.storybook.url);

        if (mode === "static") {
          try {
            const fresh = await withStorybookLock(() =>
              ensureStaticStorybookFresh({
                projectRoot: PROJECT_ROOT,
                port: storybookPort,
                statsFile: config.compare.statsFile,
                currentProcess: storybookProcess,
              }),
            );
            storybookProcess = fresh.process;
            storybookReady = fresh.ready;
            if (fresh.rebuilt) {
              console.log("✅ [vr-daemon] Storybook statique reconstruit et prêt");
            }
          } catch (err) {
            console.error("❌ [vr-daemon] Rebuild Storybook statique échoué:", err);
            sendJson(res, { success: false, error: err instanceof Error ? err.message : String(err) }, 503);
            return;
          }
          if (!storybookReady) {
            sendJson(res, { success: false, error: "Storybook pas prêt après rebuild" }, 503);
            return;
          }
        } else {
          await waitForDevStorybookIndexSettle(config.storybook.url);
        }

        const result: CaptureBatchResult = await runSerialized(() => runCaptureWithConsole(tasks, options));
        sendJson(res, result);
      } catch (err) {
        console.error("❌ [vr-daemon] Erreur capture/batch:", err);
        sendJson(res, { success: false, error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    sendJson(res, { error: "Not found" }, 404);
  };

  const server = createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error("❌ [vr-daemon] Erreur handler:", err);
      if (!res.headersSent) sendJson(res, { error: String(err) }, 500);
    });
  });

  // 1. Le serveur écoute immédiatement : /health est joignable pendant le build.
  server.listen(CAPTURE_DAEMON_PORT, () => {
    console.log(`🟢 [vr-daemon] Serveur HTTP prêt sur le port ${CAPTURE_DAEMON_PORT} (Storybook en cours…)`);
  });

  const shutdown = (signal: string): void => {
    console.log(`\n⚠️  [vr-daemon] Arrêt (${signal})`);
    keepFresh?.stop();
    server.close();
    stopStorybook(storybookProcess);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // 2. Démarrage de Storybook (peut prendre du temps au premier build) → bascule ready.
  const storybook = await startStorybook({
    projectRoot: PROJECT_ROOT,
    port: storybookPort,
    mode,
    statsFile: config.compare.statsFile,
  });
  storybookProcess = storybook.process;
  storybookReady = storybook.ready;

  keepFresh = startStorybookKeepFresh({
    projectRoot: PROJECT_ROOT,
    mode,
    onDevChange: async files => {
      await withStorybookLock(async () => {
        nudgeFsWatchers(files);
        await waitForDevStorybookIndexSettle(config.storybook.url);
      });
    },
    onStaticChange: async () => {
      await withStorybookLock(async () => {
        storybookReady = false;
        const fresh = await ensureStaticStorybookFresh({
          projectRoot: PROJECT_ROOT,
          port: storybookPort,
          statsFile: config.compare.statsFile,
          currentProcess: storybookProcess,
        });
        storybookProcess = fresh.process;
        storybookReady = fresh.ready;
        if (fresh.rebuilt) {
          console.log("✅ [vr-daemon] Storybook statique reconstruit (keep-fresh)");
        }
      });
    },
  });

  if (!storybookReady) {
    console.error("❌ [vr-daemon] Storybook n'a pas indexé les stories à temps");
  } else {
    console.log(`✅ [vr-daemon] Storybook prêt sur le port ${storybookPort} — capture disponible (keep-fresh)`);
  }
};

main().catch(err => {
  console.error("❌ [vr-daemon] Erreur fatale:", err);
  process.exit(1);
});
