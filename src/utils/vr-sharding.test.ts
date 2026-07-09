import { afterEach, describe, expect, it } from "vitest";

import type { CaptureTask } from "../scripts/vr-capture-engine";

import {
  estimateCiWallClockMs,
  estimateShardCaptureMs,
  filterTasksByShard,
  formatShardBenchmarkAlert,
  getShardBenchmarkAlerts,
  getShardDistributionStats,
  hashStoryIdForShard,
  parseShardConfigFromEnv,
  partitionTasksByShardTotal,
  storyIdBelongsToShard,
} from "./vr-sharding";

const task = (storyId: string): CaptureTask => ({
  storyId,
  deviceName: "desktop-fhd",
  componentDir: "src/demo",
});

describe("parseShardConfigFromEnv", () => {
  const originalIndex = process.env.VR_SHARD_INDEX;
  const originalTotal = process.env.VR_SHARD_TOTAL;

  afterEach(() => {
    if (originalIndex === undefined) delete process.env.VR_SHARD_INDEX;
    else process.env.VR_SHARD_INDEX = originalIndex;
    if (originalTotal === undefined) delete process.env.VR_SHARD_TOTAL;
    else process.env.VR_SHARD_TOTAL = originalTotal;
  });

  it("returns null when env vars are absent", () => {
    delete process.env.VR_SHARD_INDEX;
    delete process.env.VR_SHARD_TOTAL;
    expect(parseShardConfigFromEnv()).toBeNull();
  });

  it("parses valid shard config", () => {
    process.env.VR_SHARD_INDEX = "2";
    process.env.VR_SHARD_TOTAL = "4";
    expect(parseShardConfigFromEnv()).toEqual({ index: 2, total: 4 });
  });

  it("returns null for invalid total", () => {
    process.env.VR_SHARD_INDEX = "0";
    process.env.VR_SHARD_TOTAL = "0";
    expect(parseShardConfigFromEnv()).toBeNull();
  });

  it("returns null when index is out of range", () => {
    process.env.VR_SHARD_INDEX = "4";
    process.env.VR_SHARD_TOTAL = "4";
    expect(parseShardConfigFromEnv()).toBeNull();
  });
});

describe("hashStoryIdForShard", () => {
  it("returns a stable hash for the same storyId", () => {
    expect(hashStoryIdForShard("demo-button--primary")).toBe(hashStoryIdForShard("demo-button--primary"));
  });

  it("returns different hashes for different storyIds", () => {
    expect(hashStoryIdForShard("a--x")).not.toBe(hashStoryIdForShard("b--x"));
  });
});

describe("partitionTasksByShardTotal", () => {
  it("preserves all tasks across shards", () => {
    const tasks = [task("a--1"), task("b--2"), task("c--3"), task("d--4")];
    const shards = partitionTasksByShardTotal(tasks, 2);
    expect(shards).toHaveLength(2);
    expect(shards.flat()).toHaveLength(tasks.length);
  });

  it("returns all tasks in one shard when total is invalid", () => {
    const tasks = [task("a--1"), task("b--2")];
    expect(partitionTasksByShardTotal(tasks, 0)).toEqual([tasks]);
  });
});

describe("storyIdBelongsToShard", () => {
  it("assigns storyId consistently to a shard", () => {
    const storyId = "demo-card--default";
    const total = 4;
    const shardIndex = hashStoryIdForShard(storyId) % total;
    expect(storyIdBelongsToShard(storyId, { index: shardIndex, total })).toBe(true);
    expect(storyIdBelongsToShard(storyId, { index: (shardIndex + 1) % total, total })).toBe(false);
  });
});

describe("filterTasksByShard", () => {
  it("returns all tasks when shard config is null", () => {
    const tasks = [task("a--1"), task("b--2")];
    const result = filterTasksByShard(tasks, null);
    expect(result.tasks).toEqual(tasks);
    expect(result.skipped).toBe(0);
    expect(result.shard).toBeNull();
  });
});

describe("estimateShardCaptureMs", () => {
  it("returns 0 for empty or invalid input", () => {
    expect(estimateShardCaptureMs(0, 8, 1000)).toBe(0);
    expect(estimateShardCaptureMs(10, 8, 0)).toBe(0);
  });

  it("estimates capture duration from concurrency", () => {
    expect(estimateShardCaptureMs(16, 8, 1000)).toBe(2000);
    expect(estimateShardCaptureMs(9, 8, 1000)).toBe(2000);
  });
});

describe("estimateCiWallClockMs", () => {
  it("adds setup time to the slowest shard", () => {
    expect(estimateCiWallClockMs([10, 20], 5, 1000, 180_000)).toBe(180_000 + 4000);
  });

  it("returns setup time when there are no shards", () => {
    expect(estimateCiWallClockMs([], 5, 1000, 180_000)).toBe(180_000);
  });
});

describe("getShardDistributionStats", () => {
  it("computes imbalance percentage", () => {
    const stats = getShardDistributionStats([10, 10, 30]);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.avg).toBeCloseTo(50 / 3);
    expect(stats.imbalancePct).toBeGreaterThan(0);
  });
});

describe("getShardBenchmarkAlerts", () => {
  it("flags too many shards when min tasks per shard is low", () => {
    const stats = getShardDistributionStats([3, 4, 2, 5]);
    expect(getShardBenchmarkAlerts(4, stats, 1)).toContain("too_many_shards");
  });

  it("flags imbalanced distribution", () => {
    const stats = getShardDistributionStats([5, 5, 30]);
    expect(getShardBenchmarkAlerts(3, stats, 1)).toContain("imbalanced");
  });

  it("flags unnecessary sharding", () => {
    const stats = getShardDistributionStats([20, 18]);
    expect(getShardBenchmarkAlerts(2, stats, 1)).toContain("sharding_unnecessary");
  });
});

describe("formatShardBenchmarkAlert", () => {
  it("formats known alerts", () => {
    expect(formatShardBenchmarkAlert("too_many_shards")).toContain("8 tâches");
    expect(formatShardBenchmarkAlert("imbalanced")).toContain("25");
    expect(formatShardBenchmarkAlert("sharding_unnecessary")).toContain("inutile");
  });
});
