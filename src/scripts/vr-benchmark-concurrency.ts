/**
 * Benchmark concurrency : mesure runCaptureBatch pour concurrency 1..max.
 *
 * Usage (package) :
 *   yarn vr:benchmark
 *   yarn vr:benchmark 12
 *
 * Usage (projet hôte via CLI) :
 *   npx visual-regression benchmark
 *   npx visual-regression benchmark 12
 *
 * Prérequis : Storybook démarré (yarn storybook ou yarn vr).
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

import { FORCE_VR_TAG, IGNORE_VR_TAG } from "@constants/constants";
import type { CaptureTask } from "@scripts/vr-capture-engine";
import { runCaptureBatch } from "@scripts/vr-capture-engine";
import { getDevicesConfig, getProjectRoot, resolveVrConfig, waitForStorybookStories } from "@utils/node";

const PROJECT_ROOT = getProjectRoot();

const parseMaxConcurrency = (): number => {
  const numericArg = process.argv.slice(2).find(arg => /^\d+$/.test(arg));
  if (!numericArg) return 16;
  return Math.min(16, Math.max(1, Number(numericArg)));
};

const MAX = parseMaxConcurrency();

type StoryIndexEntry = {
  id: string;
  type?: string;
  importPath: string;
  tags?: string[];
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

const buildTasks = (stories: StoryIndexEntry[]): CaptureTask[] => {
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

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const main = async () => {
  const storybookUrl = resolveVrConfig(PROJECT_ROOT).storybook.url;
  const ready = await waitForStorybookStories(1, 30);
  if (!ready) {
    console.error(`❌ Storybook (${storybookUrl}) indisponible. Lancez yarn storybook ou yarn vr.`);
    process.exit(1);
  }

  const stories = await fetchStories();
  const tasks = buildTasks(stories);
  const deviceCount = Object.keys(getDevicesConfig(resolveVrConfig(PROJECT_ROOT).devices)).length;

  console.log(`\n📊 Benchmark concurrency 1..${MAX}`);
  console.log(`   ${stories.length} stories × ${deviceCount} devices = ${tasks.length} tâches`);
  console.log(`   (mode incremental, pas de wipe entre runs)\n`);
  console.log("Concurrency | Durée    | ms/tâche");
  console.log("------------|----------|----------");

  const results: { concurrency: number; durationMs: number }[] = [];

  for (let concurrency = 1; concurrency <= MAX; concurrency++) {
    const result = await runCaptureBatch(tasks, {
      mode: "incremental",
      concurrency,
    });
    const { durationMs } = result.stats;
    results.push({ concurrency, durationMs });
    const avgMs = durationMs / tasks.length;
    console.log(
      `${String(concurrency).padStart(11)} | ${formatMs(durationMs).padStart(8)} | ${formatMs(avgMs).padStart(8)}`,
    );
  }

  const best = results.reduce((a, b) => (a.durationMs <= b.durationMs ? a : b));
  const sorted = [...results].sort((a, b) => a.durationMs - b.durationMs);

  console.log("\n─────────── Résultat ───────────");
  console.log(`🏆 Optimal : concurrency = ${best.concurrency} (${formatMs(best.durationMs)})`);

  try {
    const cacheDir = path.join(PROJECT_ROOT, ".vr-cache");
    mkdirSync(cacheDir, { recursive: true });
    const msPerTask = best.durationMs / tasks.length;
    writeFileSync(
      path.join(cacheDir, "benchmark-last.json"),
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          concurrency: best.concurrency,
          durationMs: best.durationMs,
          taskCount: tasks.length,
          msPerTask,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`   Cache : .vr-cache/benchmark-last.json (${Math.round(msPerTask)} ms/tâche)`);
  } catch {
    // ignore cache write errors
  }

  console.log("\nTop 5 :");
  sorted.slice(0, 5).forEach((r, i) => {
    const delta = r.durationMs - best.durationMs;
    const suffix = delta === 0 ? " ← meilleur" : ` (+${formatMs(delta)})`;
    console.log(`  ${i + 1}. concurrency ${r.concurrency} — ${formatMs(r.durationMs)}${suffix}`);
  });
};

main().catch(err => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
