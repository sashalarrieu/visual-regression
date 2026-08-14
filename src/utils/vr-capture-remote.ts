/**
 * Client HTTP du daemon de capture (sidecar Docker).
 *
 * Le hôte n'exécute jamais Playwright : il envoie les tâches au daemon via
 * POST /capture/batch et agrège les résultats. Les captures sont découpées en
 * lots pour éviter les timeouts de `fetch` sur les gros batches.
 */
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import path from "path";

import type { CaptureBatchOptions, CaptureBatchResult, CaptureTask } from "../scripts/vr-capture-engine";
import type { VrConfig } from "../types/types";

import { getProjectRoot } from "./node";
import { getCaptureDaemonUrl } from "./vr-capture-backend";
import {
  captureErrorKey,
  syncCaptureErrorsAllFailed,
  syncCaptureErrorsFromBatch,
  withoutIgnoredCaptureErrors,
  type CaptureErrorItem,
} from "./vr-capture-errors";
import { formatCaptureProgressLine, readCaptureProgress, writeCaptureProgress } from "./vr-capture-progress";
import { collectIgnoredVrStoryIds } from "./vr-story-eligibility";
import { peekStorybookIndexEntries } from "./vr-storybook-index";
/** Réponse de GET /health du sidecar. */
export type CaptureDaemonHealth = {
  ready?: boolean;
  mode?: string;
  storybook?: boolean;
  /** Chemin absolu du projet hôte monté (pas /work dans le conteneur). */
  hostProjectRoot?: string;
  /** Nom Compose du stack qui sert ce daemon. */
  composeProjectName?: string;
};

/** Lit /health sans attendre ready. */
export const fetchCaptureDaemonHealth = async (config?: VrConfig): Promise<CaptureDaemonHealth | null> => {
  try {
    const res = await fetch(`${getCaptureDaemonUrl(config)}/health`);
    if (!res.ok) return null;
    return (await res.json()) as CaptureDaemonHealth;
  } catch {
    return null;
  }
};

/**
 * true si le sidecar actif correspond au projet courant **et** au mode Storybook attendu.
 * Sans hostProjectRoot (vieux daemon) → false pour forcer une recréation sûre.
 * Un sidecar static ne doit jamais être réutilisé quand on veut du HMR (stories figées).
 */
export const isCaptureDaemonReusableForProject = (
  health: CaptureDaemonHealth | null,
  projectRoot: string,
  expectedMode?: string,
): boolean => {
  if (!health?.ready) return false;
  const remote = health.hostProjectRoot?.trim();
  if (!remote) return false;
  if (path.resolve(remote) !== path.resolve(projectRoot)) return false;
  if (expectedMode && health.mode && health.mode !== expectedMode) return false;
  return true;
};

/** Options envoyées au daemon (onProgress n'est pas sérialisable). */
type SerializableOptions = Omit<CaptureBatchOptions, "onProgress">;

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const getChunkSize = (config: VrConfig): number => {
  const size = config.capture.remoteChunkSize;
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : 20;
};

/** Attend que le daemon soit prêt (Storybook indexé + pool disponible). */
export const waitForCaptureDaemon = async (maxAttempts = 120, config?: VrConfig): Promise<boolean> => {
  const url = `${getCaptureDaemonUrl(config)}/health`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { ready?: boolean; mode?: string; storybook?: unknown };
        if (body.ready) return true;
      }
    } catch {
      // retry until maxAttempts
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};

const formatTransportError = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : "";
  return cause ? `${err.message} (${cause})` : err.message;
};

/** POST JSON fiable (fetch Node/Windows peut échouer sur les gros body vers Docker). */
const postJson = (urlString: string, payload: unknown): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(urlString);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

const postBatch = async (
  tasks: CaptureTask[],
  options: SerializableOptions,
  config: VrConfig,
): Promise<CaptureBatchResult> => {
  let response: { status: number; body: string };
  try {
    response = await postJson(`${getCaptureDaemonUrl(config)}/capture/batch`, { tasks, options });
  } catch (err) {
    throw new Error(`Capture daemon injoignable: ${formatTransportError(err)}`);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Capture daemon a répondu ${response.status}: ${response.body.slice(0, 200)}`);
  }

  let result: CaptureBatchResult;
  try {
    result = JSON.parse(response.body) as CaptureBatchResult;
  } catch {
    throw new Error("Réponse daemon invalide (JSON)");
  }

  if (!result.stats) {
    throw new Error("Réponse daemon invalide (stats manquantes)");
  }
  return result;
};

/** Suit `.vr-cache/capture-progress.json` pendant l'attente d'un lot Docker. */
const watchCaptureProgress = (
  projectRoot: string,
  meta: { chunk: number; chunks: number; chunkTotal: number },
): { stop: () => void } => {
  let lastKey = "";
  const tick = (): void => {
    const snapshot = readCaptureProgress(projectRoot);
    if (!snapshot) return;
    const key = `${snapshot.done}:${snapshot.storyId}:${snapshot.deviceName}`;
    if (key === lastKey) return;
    lastKey = key;
    console.log(
      formatCaptureProgressLine({
        ...snapshot,
        total: snapshot.total || meta.chunkTotal,
        chunk: meta.chunk,
        chunks: meta.chunks,
      }),
    );
  };
  const timer = setInterval(tick, 1500);
  tick();
  return {
    stop: () => {
      clearInterval(timer);
      tick();
    },
  };
};

/**
 * Exécute un batch de capture via le daemon Docker, en découpant en lots.
 * wipePublicDir n'est appliqué que sur le premier lot.
 */
export const runCaptureBatchRemote = async (
  tasks: CaptureTask[],
  options: CaptureBatchOptions,
  config: VrConfig,
): Promise<CaptureBatchResult> => {
  const { onProgress, ...serializable } = options;
  const chunkSize = getChunkSize(config);
  const chunks = chunk(tasks, chunkSize);

  const aggregate: CaptureBatchResult = {
    success: true,
    stats: { total: tasks.length, completed: 0, errors: 0, vrs: 0, news: 0, durationMs: 0 },
    logs: { errors: [], vrs: [], news: [] },
    storiesWithDiff: [],
    storiesWithErrors: [],
  };
  const projectRoot = getProjectRoot();
  const ignoredStoryIds = (() => {
    const cached = peekStorybookIndexEntries(config.storybook.url);
    return cached ? collectIgnoredVrStoryIds(cached) : new Set<string>();
  })();

  const daemonReady = await waitForCaptureDaemon(5, config);
  if (!daemonReady) {
    const message = `Daemon de capture injoignable (${getCaptureDaemonUrl(config)}) — démarrez Docker (pnpm vr) ou VR_CAPTURE_BACKEND=local`;
    aggregate.success = false;
    aggregate.error = message;
    aggregate.logs.errors.push(`🚫 ${message}`);
    syncCaptureErrorsAllFailed(projectRoot, tasks, message, ignoredStoryIds);
    aggregate.storiesWithErrors = withoutIgnoredCaptureErrors(
      tasks.map(task => ({
        storyId: task.storyId,
        deviceName: task.deviceName,
        componentDir: task.componentDir,
        message,
        at: Date.now(),
      })),
      ignoredStoryIds,
    );
    return aggregate;
  }

  if (chunks.length === 0) {
    aggregate.success = false;
    aggregate.error = "Aucun lot de capture (chunk size invalide ?)";
    aggregate.logs.errors.push(`🚫 ${aggregate.error}`);
    return aggregate;
  }

  console.log(`\n🐳 Capture via daemon Docker (${tasks.length} tâche(s), ${chunks.length} lot(s) de ${chunkSize})…`);

  const showDockerLogs = config.docker.showLogs === true;
  const resolvedTasks: CaptureTask[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkTasks = chunks[i];
    const chunkOptions: SerializableOptions = {
      ...serializable,
      wipePublicDir: i === 0 ? serializable.wipePublicDir : false,
    };

    console.log(`🐳 Lot ${i + 1}/${chunks.length} (${chunkTasks.length} tâche(s))…`);
    writeCaptureProgress(projectRoot, {
      done: 0,
      total: chunkTasks.length,
      chunk: i + 1,
      chunks: chunks.length,
      updatedAt: Date.now(),
    });
    // Si docker.showLogs : la progression/compare sort déjà via `vr-capture-1 |` — pas de doublon hôte.
    const progressWatch = showDockerLogs
      ? null
      : watchCaptureProgress(projectRoot, {
          chunk: i + 1,
          chunks: chunks.length,
          chunkTotal: chunkTasks.length,
        });

    let result: CaptureBatchResult;
    try {
      result = await postBatch(chunkTasks, chunkOptions, config);
    } catch (err) {
      progressWatch?.stop();
      const message = err instanceof Error ? err.message : String(err);
      aggregate.success = false;
      aggregate.error = message;
      aggregate.logs.errors.push(`🚫 Capture daemon: ${message}`);
      const at = Date.now();
      const abortedErrors: CaptureErrorItem[] = [];
      for (let j = i; j < chunks.length; j++) {
        for (const task of chunks[j]) {
          abortedErrors.push({
            storyId: task.storyId,
            deviceName: task.deviceName,
            componentDir: task.componentDir,
            message,
            at,
          });
          resolvedTasks.push(task);
        }
      }
      aggregate.storiesWithErrors.push(...abortedErrors);
      break;
    }
    progressWatch?.stop();

    // Rejoue la console daemon sur l'hôte seulement si on ne suit pas déjà docker logs.
    if (!showDockerLogs && result.consoleOutput?.length) {
      for (const line of result.consoleOutput) {
        process.stdout.write(`${line}\n`);
      }
    }

    aggregate.success = aggregate.success && result.success;
    if (result.error) aggregate.error = result.error;
    aggregate.stats.completed += result.stats?.completed ?? 0;
    aggregate.stats.errors += result.stats?.errors ?? 0;
    aggregate.stats.vrs += result.stats?.vrs ?? 0;
    aggregate.stats.news += result.stats?.news ?? 0;
    aggregate.stats.durationMs += result.stats?.durationMs ?? 0;
    aggregate.logs.errors.push(...(result.logs?.errors ?? []));
    aggregate.logs.vrs.push(...(result.logs?.vrs ?? []));
    aggregate.logs.news.push(...(result.logs?.news ?? []));
    aggregate.storiesWithDiff.push(...(result.storiesWithDiff ?? []));

    const chunkErrors = result.storiesWithErrors;
    if (Array.isArray(chunkErrors)) {
      aggregate.storiesWithErrors.push(...chunkErrors);
    } else if ((result.stats?.errors ?? 0) > 0 || (result.logs?.errors?.length ?? 0) > 0) {
      // Daemon ancien sans storiesWithErrors : fallback — marque le lot entier si erreurs.
      const at = Date.now();
      const message = result.logs?.errors?.[result.logs.errors.length - 1] ?? result.error ?? "Capture failed";
      for (const task of chunkTasks) {
        aggregate.storiesWithErrors.push({
          storyId: task.storyId,
          deviceName: task.deviceName,
          componentDir: task.componentDir,
          message,
          at,
        });
      }
    }
    resolvedTasks.push(...chunkTasks);

    onProgress?.(aggregate.stats.completed, tasks.length);
  }
  if (tasks.length > 0 && aggregate.success && aggregate.stats.completed === 0 && aggregate.stats.durationMs < 100) {
    aggregate.success = false;
    aggregate.error = "Aucune capture exécutée par le daemon (durée ~0 ms)";
    aggregate.logs.errors.push(`🚫 ${aggregate.error}`);
    syncCaptureErrorsAllFailed(projectRoot, tasks, aggregate.error, ignoredStoryIds);
    aggregate.storiesWithErrors = withoutIgnoredCaptureErrors(
      tasks.map(task => ({
        storyId: task.storyId,
        deviceName: task.deviceName,
        componentDir: task.componentDir,
        message: aggregate.error!,
        at: Date.now(),
      })),
      ignoredStoryIds,
    );
    return aggregate;
  }

  // Déduplique les erreurs (clé device::story) puis sync le store hôte.
  aggregate.storiesWithErrors = withoutIgnoredCaptureErrors(aggregate.storiesWithErrors, ignoredStoryIds);
  const byKey = new Map(
    aggregate.storiesWithErrors.map(item => [captureErrorKey(item.storyId, item.deviceName), item]),
  );
  aggregate.storiesWithErrors = Array.from(byKey.values());
  if (resolvedTasks.length > 0) {
    syncCaptureErrorsFromBatch(projectRoot, resolvedTasks, aggregate.storiesWithErrors, ignoredStoryIds);
  }

  return aggregate;
};
