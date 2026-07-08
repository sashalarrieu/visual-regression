/**
 * Client HTTP du daemon de capture (sidecar Docker).
 *
 * Le hôte n'exécute jamais Playwright : il envoie les tâches au daemon via
 * POST /capture/batch et agrège les résultats. Les captures sont découpées en
 * lots pour éviter les timeouts de `fetch` sur les gros batches.
 */
import type { CaptureBatchOptions, CaptureBatchResult, CaptureTask } from "@scripts/vr-capture-engine";
import { getCaptureDaemonUrl } from "@utils/vr-capture-backend";

/** Options envoyées au daemon (onProgress n'est pas sérialisable). */
type SerializableOptions = Omit<CaptureBatchOptions, "onProgress">;

const DEFAULT_CHUNK_SIZE = 20;

const getChunkSize = (): number => {
  const raw = Number(process.env.VR_CAPTURE_REMOTE_CHUNK);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CHUNK_SIZE;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

/** Attend que le daemon soit prêt (Storybook indexé + pool disponible). */
export const waitForCaptureDaemon = async (maxAttempts = 120): Promise<boolean> => {
  const url = `${getCaptureDaemonUrl()}/health`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { ready?: boolean };
        if (body.ready) return true;
      }
    } catch {
      // daemon pas encore joignable
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};

const postBatch = async (tasks: CaptureTask[], options: SerializableOptions): Promise<CaptureBatchResult> => {
  const res = await fetch(`${getCaptureDaemonUrl()}/capture/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks, options }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Capture daemon a répondu ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as CaptureBatchResult;
};

/**
 * Exécute un batch de capture via le daemon Docker, en découpant en lots.
 * wipePublicDir n'est appliqué que sur le premier lot.
 */
export const runCaptureBatchRemote = async (
  tasks: CaptureTask[],
  options: CaptureBatchOptions,
): Promise<CaptureBatchResult> => {
  const { onProgress, ...serializable } = options;
  const chunks = chunk(tasks, getChunkSize());

  const aggregate: CaptureBatchResult = {
    success: true,
    stats: { total: tasks.length, completed: 0, errors: 0, vrs: 0, news: 0, durationMs: 0 },
    logs: { errors: [], vrs: [], news: [] },
    storiesWithDiff: [],
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunkOptions: SerializableOptions = {
      ...serializable,
      wipePublicDir: i === 0 ? serializable.wipePublicDir : false,
    };

    let result: CaptureBatchResult;
    try {
      result = await postBatch(chunks[i], chunkOptions);
    } catch (err) {
      aggregate.success = false;
      aggregate.error = err instanceof Error ? err.message : String(err);
      break;
    }

    // Rejoue la sortie console du daemon dans la console de l'hôte (yarn vr) :
    // restaure l'affichage des logs de capture perdu depuis le passage en Docker.
    if (result.consoleOutput?.length) {
      for (const line of result.consoleOutput) {
        process.stdout.write(`${line}\n`);
      }
    }

    aggregate.success = aggregate.success && result.success;
    if (result.error) aggregate.error = result.error;
    aggregate.stats.completed += result.stats.completed;
    aggregate.stats.errors += result.stats.errors;
    aggregate.stats.vrs += result.stats.vrs;
    aggregate.stats.news += result.stats.news;
    aggregate.stats.durationMs += result.stats.durationMs;
    aggregate.logs.errors.push(...result.logs.errors);
    aggregate.logs.vrs.push(...result.logs.vrs);
    aggregate.logs.news.push(...result.logs.news);
    aggregate.storiesWithDiff.push(...result.storiesWithDiff);

    onProgress?.(aggregate.stats.completed, tasks.length);
  }

  return aggregate;
};
