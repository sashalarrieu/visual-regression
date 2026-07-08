/**
 * Benchmark sharding CI : simulation temps wall-clock par (VR_SHARD_TOTAL, concurrency).
 *
 * Usage :
 *   yarn vr:benchmark-shards
 *   yarn vr:benchmark-shards 8 --concurrency 12,15,16 --ms-per-task 1800
 *   yarn vr:benchmark-shards --calibrate --full
 *   yarn vr:benchmark-shards --incremental
 *
 * Prérequis : Storybook démarré (yarn storybook ou yarn vr).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { FORCE_VR_TAG, IGNORE_VR_TAG } from "@constants/constants";
import type { CaptureTask } from "@scripts/vr-capture-engine";
import { runCaptureBatch } from "@scripts/vr-capture-engine";
import {
  getDevicesConfig,
  getProjectPaths,
  getProjectRoot,
  resolveVrConfig,
  waitForStorybookStories,
} from "@utils/node";
import { filterCaptureTasks, getChangedFiles, type StoryIndexEntry } from "@utils/vr-incremental";
import {
  estimateCiWallClockMs,
  formatShardBenchmarkAlert,
  getShardBenchmarkAlerts,
  getShardDistributionStats,
  partitionTasksByShardTotal,
} from "@utils/vr-sharding";

const PROJECT_ROOT = getProjectRoot();
const { publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR } = getProjectPaths(PROJECT_ROOT);

const DEFAULT_MAX_SHARDS = 8;
const DEFAULT_SETUP_MS = 180_000;
const DEFAULT_MS_PER_TASK = 2000;
const BENCHMARK_CACHE_PATH = ".vr-cache/benchmark-last.json";
const CALIBRATE_SAMPLE_SIZE = 20;

type CliOptions = {
  maxShards: number;
  setupMs: number;
  msPerTask: number | null;
  calibrate: boolean;
  taskMode: "full" | "incremental";
  concurrencyList: number[];
};

type SimulationRow = {
  shardTotal: number;
  concurrency: number;
  ciMs: number;
  stats: ReturnType<typeof getShardDistributionStats>;
  alerts: ReturnType<typeof getShardBenchmarkAlerts>;
};

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

const parseArgs = (): CliOptions => {
  const argv = process.argv.slice(2);
  const config = resolveVrConfig(PROJECT_ROOT);
  const baseConcurrency = config.capture.concurrency;

  let maxShards = DEFAULT_MAX_SHARDS;
  let setupMs = DEFAULT_SETUP_MS;
  let msPerTask: number | null = null;
  let calibrate = false;
  let taskMode: "full" | "incremental" = "full";
  let concurrencyList: number[] | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--calibrate") {
      calibrate = true;
      continue;
    }
    if (arg === "--full") {
      taskMode = "full";
      continue;
    }
    if (arg === "--incremental") {
      taskMode = "incremental";
      continue;
    }
    if (arg === "--max-shards" && argv[i + 1]) {
      maxShards = Math.max(1, Number(argv[++i]));
      continue;
    }
    if (arg === "--setup-ms" && argv[i + 1]) {
      setupMs = Math.max(0, Number(argv[++i]));
      continue;
    }
    if (arg === "--ms-per-task" && argv[i + 1]) {
      msPerTask = Math.max(1, Number(argv[++i]));
      continue;
    }
    if (arg === "--concurrency" && argv[i + 1]) {
      concurrencyList = argv[++i]
        .split(",")
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n > 0);
      continue;
    }
    if (/^\d+$/.test(arg)) {
      maxShards = Math.max(1, Number(arg));
    }
  }

  if (!concurrencyList || concurrencyList.length === 0) {
    const neighbors = new Set([baseConcurrency - 3, baseConcurrency, baseConcurrency + 1].filter(n => n >= 1));
    concurrencyList = [...neighbors].sort((a, b) => a - b);
  }

  return {
    maxShards,
    setupMs,
    msPerTask,
    calibrate,
    taskMode,
    concurrencyList,
  };
};

const normalizeComponentDir = (dir: string): string => dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

const fetchStories = async (): Promise<StoryIndexEntry[]> => {
  const storybookUrl = resolveVrConfig(PROJECT_ROOT).storybook.url;
  const res = await fetch(`${storybookUrl}/index.json`);
  if (!res.ok) throw new Error(`Storybook indisponible (${storybookUrl})`);
  const data = (await res.json()) as { entries?: Record<string, StoryIndexEntry> };
  return Object.values(data.entries ?? {}).filter(entry => {
    if (entry.type !== "story" || entry.id?.endsWith("--docs")) return false;
    const tags = entry.tags ?? [];
    return tags.includes(FORCE_VR_TAG) || !tags.includes(IGNORE_VR_TAG);
  });
};

const buildAllTasks = (stories: StoryIndexEntry[]): CaptureTask[] => {
  const devices = getDevicesConfig(resolveVrConfig(PROJECT_ROOT).devices);
  const tasks: CaptureTask[] = [];
  for (const story of stories) {
    for (const deviceName of Object.keys(devices)) {
      tasks.push({
        storyId: story.id,
        deviceName,
        componentDir: normalizeComponentDir(path.dirname(story.importPath)),
      });
    }
  }
  return tasks;
};

const resolveTasksForMode = async (
  stories: StoryIndexEntry[],
  mode: "full" | "incremental",
): Promise<CaptureTask[]> => {
  const allTasks = buildAllTasks(stories);
  if (mode === "full") return allTasks;

  const config = resolveVrConfig(PROJECT_ROOT);
  const changedFiles = getChangedFiles(PROJECT_ROOT, config);
  const { tasks } = filterCaptureTasks(allTasks, config, stories, {
    projectRoot: PROJECT_ROOT,
    publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR,
    changedFiles,
  });
  return tasks;
};

const readBenchmarkCacheMsPerTask = (): number | null => {
  const cachePath = path.join(PROJECT_ROOT, BENCHMARK_CACHE_PATH);
  if (!existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(readFileSync(cachePath, "utf8")) as { msPerTask?: number };
    return typeof data.msPerTask === "number" && data.msPerTask > 0 ? data.msPerTask : null;
  } catch {
    return null;
  }
};

/** Persiste la mesure dans .vr-cache/benchmark-last.json (format partagé avec vr:benchmark). */
const writeBenchmarkCache = (msPerTask: number, taskCount: number, concurrency: number): void => {
  try {
    const cacheDir = path.join(PROJECT_ROOT, path.dirname(BENCHMARK_CACHE_PATH));
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      path.join(PROJECT_ROOT, BENCHMARK_CACHE_PATH),
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          concurrency,
          durationMs: Math.round(msPerTask * taskCount),
          taskCount,
          msPerTask,
          source: "calibrate",
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`   Cache : ${BENCHMARK_CACHE_PATH} (${Math.round(msPerTask)} ms/tâche)`);
  } catch {
    // ignore cache write errors
  }
};

const calibrateMsPerTask = async (tasks: CaptureTask[], concurrency: number): Promise<number> => {
  const sampleSize = Math.min(CALIBRATE_SAMPLE_SIZE, tasks.length);
  const sample = tasks.slice(0, sampleSize);
  console.log(`\n🔬 Calibration : ${sampleSize} tâche(s) à concurrency ${concurrency}…`);

  const result = await runCaptureBatch(sample, {
    mode: "incremental",
    concurrency,
  });

  const msPerTask = result.stats.durationMs / sampleSize;
  console.log(`   Mesuré : ${formatMs(result.stats.durationMs)} total → ${Math.round(msPerTask)} ms/tâche`);
  writeBenchmarkCache(msPerTask, sampleSize, concurrency);
  return msPerTask;
};

const resolveMsPerTask = async (
  options: CliOptions,
  tasks: CaptureTask[],
): Promise<{ msPerTask: number; source: string }> => {
  if (options.msPerTask !== null) {
    return { msPerTask: options.msPerTask, source: "--ms-per-task" };
  }

  if (options.calibrate) {
    const concurrency = resolveVrConfig(PROJECT_ROOT).capture.concurrency;
    const measured = await calibrateMsPerTask(tasks, concurrency);
    return { msPerTask: measured, source: "--calibrate" };
  }

  const cached = readBenchmarkCacheMsPerTask();
  if (cached !== null) {
    return { msPerTask: cached, source: BENCHMARK_CACHE_PATH };
  }

  console.warn(`⚠️  ms/tâche inconnu — fallback ${DEFAULT_MS_PER_TASK} ms. Lancez yarn vr:benchmark ou --calibrate.`);
  return { msPerTask: DEFAULT_MS_PER_TASK, source: "défaut" };
};

const runSimulation = (tasks: CaptureTask[], options: CliOptions, msPerTask: number): SimulationRow[] => {
  const rows: SimulationRow[] = [];
  let bestShardTotal = 1;
  let bestCiMs = Infinity;

  for (let shardTotal = 1; shardTotal <= options.maxShards; shardTotal++) {
    const partitions = partitionTasksByShardTotal(tasks, shardTotal);
    const counts = partitions.map(p => p.length);

    for (const concurrency of options.concurrencyList) {
      const ciMs = estimateCiWallClockMs(counts, concurrency, msPerTask, options.setupMs);
      if (ciMs < bestCiMs) {
        bestCiMs = ciMs;
        bestShardTotal = shardTotal;
      }
    }
  }

  for (let shardTotal = 1; shardTotal <= options.maxShards; shardTotal++) {
    const partitions = partitionTasksByShardTotal(tasks, shardTotal);
    const counts = partitions.map(p => p.length);
    const stats = getShardDistributionStats(counts);

    for (const concurrency of options.concurrencyList) {
      const ciMs = estimateCiWallClockMs(counts, concurrency, msPerTask, options.setupMs);
      const alerts = getShardBenchmarkAlerts(shardTotal, stats, bestShardTotal);
      rows.push({ shardTotal, concurrency, ciMs, stats, alerts });
    }
  }

  return rows;
};

const printReport = (
  rows: SimulationRow[],
  options: CliOptions,
  msPerTask: number,
  msSource: string,
  taskCount: number,
): void => {
  const best = rows.reduce((a, b) => (a.ciMs <= b.ciMs ? a : b));

  console.log(`\n📊 Benchmark sharding (simulation)`);
  console.log(`   ${taskCount} tâche(s) | mode ${options.taskMode}`);
  console.log(`   setup/job : ${formatMs(options.setupMs)} | ms/tâche : ${Math.round(msPerTask)} (${msSource})`);
  console.log(`   shardTotal 1..${options.maxShards} × concurrency [${options.concurrencyList.join(", ")}]\n`);
  console.log("shardTotal | concurrency | T_CI estimé | tâches/shard [min..max] | alertes");
  console.log("-----------|-------------|-------------|------------------------|--------");

  for (const row of rows) {
    const alertLabels = row.alerts.length > 0 ? row.alerts.map(formatShardBenchmarkAlert).join("; ") : "—";
    const range = `[${row.stats.min}..${row.stats.max}]`;
    const marker = row.shardTotal === best.shardTotal && row.concurrency === best.concurrency ? " *" : "";
    console.log(
      `${String(row.shardTotal).padStart(10)} | ${String(row.concurrency).padStart(11)} | ${formatMs(row.ciMs).padStart(11)} | ${range.padStart(22)} | ${alertLabels}${marker}`,
    );
  }

  const bestAlerts = best.alerts.filter(a => a !== "sharding_unnecessary");
  const maxCaptureMs = best.ciMs - options.setupMs;

  console.log("\n─────────── Résultat ───────────");
  console.log(`🏆 Recommandé CI : shardTotal=${best.shardTotal}, concurrency=${best.concurrency}`);
  console.log(
    `   T_CI estimé : ${formatMs(best.ciMs)} (setup ${formatMs(options.setupMs)} + capture max ${formatMs(maxCaptureMs)})`,
  );
  console.log(`   Répartition : [${best.stats.counts.join(", ")}]`);
  console.log(
    `   Avertissements : ${bestAlerts.length > 0 ? bestAlerts.map(formatShardBenchmarkAlert).join("; ") : "aucun"}`,
  );

  if (best.shardTotal === 1) {
    console.log("   ℹ️  Sharding inutile pour ce périmètre — 1 job CI suffit.");
  }
};

const main = async () => {
  const options = parseArgs();
  const storybookUrl = resolveVrConfig(PROJECT_ROOT).storybook.url;

  const ready = await waitForStorybookStories(1, 30);
  if (!ready) {
    console.error(`❌ Storybook (${storybookUrl}) indisponible. Lancez yarn storybook ou yarn vr.`);
    process.exit(1);
  }

  const stories = await fetchStories();
  const tasks = await resolveTasksForMode(stories, options.taskMode);

  if (tasks.length === 0) {
    console.log("\n🚫 Aucune tâche à simuler (périmètre vide).");
    process.exit(0);
  }

  const { msPerTask, source } = await resolveMsPerTask(options, tasks);
  const rows = runSimulation(tasks, options, msPerTask);
  printReport(rows, options, msPerTask, source, tasks.length);
};

main().catch(err => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
