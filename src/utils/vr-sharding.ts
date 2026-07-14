/**
 * Sharding CI : répartir les tâches de capture par storyId (env VR_SHARD_INDEX / VR_SHARD_TOTAL).
 * Ne pas importer depuis l'app React/Expo (web).
 */
import { createHash } from "crypto";

import type { CaptureTask } from "../scripts/vr-capture-engine";
import type { VrConfig } from "../types/types";

export type ShardConfig = {
  /** Index 0-based */
  index: number;
  total: number;
};

export type FilterTasksByShardResult = {
  tasks: CaptureTask[];
  skipped: number;
  shard: ShardConfig | null;
};

/** Lit VR_SHARD_INDEX (0-based) et VR_SHARD_TOTAL depuis l'environnement. */
export const parseShardConfigFromEnv = (): ShardConfig | null => {
  const totalRaw = process.env.VR_SHARD_TOTAL;
  const indexRaw = process.env.VR_SHARD_INDEX;

  if (totalRaw === undefined || indexRaw === undefined || totalRaw === "" || indexRaw === "") {
    return null;
  }

  const total = Number(totalRaw);
  const index = Number(indexRaw);

  if (!Number.isInteger(total) || total < 1) {
    console.warn(`⚠️  VR_SHARD_TOTAL invalide (${totalRaw}) — sharding ignoré`);
    return null;
  }

  if (!Number.isInteger(index) || index < 0 || index >= total) {
    console.warn(`⚠️  VR_SHARD_INDEX invalide (${indexRaw}) — sharding ignoré (attendu 0..${total - 1})`);
    return null;
  }

  return { index, total };
};

const parseShardConfigFromFile = (config?: Pick<VrConfig, "compare">): ShardConfig | null => {
  const total = config?.compare.shardTotal;
  const index = config?.compare.shardIndex;
  if (total === undefined || index === undefined) return null;
  if (!Number.isInteger(total) || total < 1) return null;
  if (!Number.isInteger(index) || index < 0 || index >= total) return null;
  return { index, total };
};

/** Sharding résolu : env VR_SHARD_* > vr.config compare.shard* > désactivé. */
export const parseShardConfig = (config?: Pick<VrConfig, "compare">): ShardConfig | null =>
  parseShardConfigFromEnv() ?? parseShardConfigFromFile(config);

/** Hash stable d'un storyId pour répartition modulo. */
export const hashStoryIdForShard = (storyId: string): number => {
  const hash = createHash("sha256").update(storyId).digest();
  return hash.readUInt32BE(0);
};

export const storyIdBelongsToShard = (storyId: string, shard: ShardConfig): boolean =>
  hashStoryIdForShard(storyId) % shard.total === shard.index;

export const filterTasksByShard = (
  tasks: CaptureTask[],
  shard: ShardConfig | null = parseShardConfigFromEnv(),
): FilterTasksByShardResult => {
  if (!shard) {
    return { tasks, skipped: 0, shard: null };
  }

  const filtered = tasks.filter(task => storyIdBelongsToShard(task.storyId, shard));
  const skipped = tasks.length - filtered.length;

  console.log(`🧩 Shard ${shard.index + 1}/${shard.total} : ${filtered.length}/${tasks.length} tâche(s)`);

  return { tasks: filtered, skipped, shard };
};

export type ShardDistributionStats = {
  min: number;
  max: number;
  avg: number;
  /** Écart relatif max vs moyenne (0..100+) */
  imbalancePct: number;
  counts: number[];
};

/** Répartit les tâches en N shards (simulation benchmark, sans effet de bord). */
export const partitionTasksByShardTotal = (tasks: CaptureTask[], total: number): CaptureTask[][] => {
  if (total < 1) return [tasks];
  const shards: CaptureTask[][] = Array.from({ length: total }, () => []);
  for (const task of tasks) {
    const index = hashStoryIdForShard(task.storyId) % total;
    shards[index].push(task);
  }
  return shards;
};

/** Durée estimée de capture pour un shard (ms). */
export const estimateShardCaptureMs = (taskCount: number, concurrency: number, msPerTask: number): number => {
  if (taskCount <= 0 || msPerTask <= 0) return 0;
  const workers = Math.max(1, concurrency);
  return Math.ceil(taskCount / workers) * msPerTask;
};

/** Temps CI wall-clock estimé (setup + shard le plus lent). */
export const estimateCiWallClockMs = (
  shardTaskCounts: number[],
  concurrency: number,
  msPerTask: number,
  setupMs: number,
): number => {
  if (shardTaskCounts.length === 0) return setupMs;
  const maxCapture = Math.max(...shardTaskCounts.map(count => estimateShardCaptureMs(count, concurrency, msPerTask)));
  return setupMs + maxCapture;
};

export const getShardDistributionStats = (counts: number[]): ShardDistributionStats => {
  if (counts.length === 0) {
    return { min: 0, max: 0, avg: 0, imbalancePct: 0, counts: [] };
  }
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const imbalancePct = avg > 0 ? Math.round(((max - avg) / avg) * 100) : 0;
  return { min, max, avg, imbalancePct, counts };
};

const MIN_TASKS_PER_SHARD = 8;
const MAX_IMBALANCE_PCT = 25;

export type ShardBenchmarkAlert = "too_many_shards" | "imbalanced" | "sharding_unnecessary";

/** Alertes heuristiques pour le rapport benchmark. */
export const getShardBenchmarkAlerts = (
  shardTotal: number,
  stats: ShardDistributionStats,
  bestShardTotal: number,
): ShardBenchmarkAlert[] => {
  const alerts: ShardBenchmarkAlert[] = [];
  if (stats.min < MIN_TASKS_PER_SHARD && shardTotal > 1) {
    alerts.push("too_many_shards");
  }
  if (stats.imbalancePct > MAX_IMBALANCE_PCT && shardTotal > 1) {
    alerts.push("imbalanced");
  }
  if (bestShardTotal === 1 && shardTotal > 1) {
    alerts.push("sharding_unnecessary");
  }
  return alerts;
};

export const formatShardBenchmarkAlert = (alert: ShardBenchmarkAlert): string => {
  switch (alert) {
    case "too_many_shards":
      return "shard avec < 8 tâches (trop de shards)";
    case "imbalanced":
      return "répartition déséquilibrée (> 25 %)";
    case "sharding_unnecessary":
      return "sharding inutile pour ce périmètre";
    default:
      return alert;
  }
};
