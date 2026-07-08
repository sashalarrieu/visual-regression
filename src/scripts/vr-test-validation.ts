/**
 * Checklist de validation Phases 0–9 (plan d'optimisation VR).
 *
 * Usage :
 *   yarn vr:test-validation              → checks statiques + Storybook si dispo
 *   yarn vr:test-validation --static-only → sans Storybook
 *   yarn vr:test-validation --help
 */
import { existsSync, readFileSync } from "fs";
import path from "path";

import { FORCE_VR_TAG, IGNORE_VR_TAG, LIVE_ANIMATION_VR_TAG } from "@constants/constants";
import { compareAllStories, compareByType, compareSelectedStories } from "@scripts/compare-visual-regressions";
import type { CaptureTask } from "@scripts/vr-capture-engine";
import {
  getDevicesConfig,
  getProjectRoot,
  getVrPublicConfig,
  loadVrConfig,
  resolveVrConfig,
  VR_CONFIG_FILENAME,
  waitForStorybookStories,
} from "@utils/node";
import { buildImportersGraph } from "@utils/vr-dependency-graph";
import { getDiffVerificationMaxAttempts, shouldRetryDiffVerification } from "@utils/vr-diff-verify";
import { filterCaptureTasks, getChangedFiles, type StoryIndexEntry } from "@utils/vr-incremental";
import { estimateCiWallClockMs, partitionTasksByShardTotal } from "@utils/vr-sharding";
import { appendVrCaptureParam, expectsVrStoryPlay, waitForStoryStable } from "@utils/vr-steadysnap";
import { normalizeStoryVrParameters, resolveEffectiveVrConfig, shouldUseBurstCapture } from "@utils/vr-story-config";

const PROJECT_ROOT = getProjectRoot();
const LEGACY_CONFIG = "vr-devices.config.cjs";

type CheckResult = { ok: boolean; message: string };

const isStaticOnly = process.argv.includes("--static-only");
const showHelp = process.argv.includes("--help") || process.argv.includes("-h");

const printHelp = (): void => {
  console.log(`
Validation Phases 0–9 — @setshao/visual-regression

Usage:
  yarn vr:test-validation              Checks statiques + Storybook si disponible
  yarn vr:test-validation --static-only  Sans prérequis Storybook

Couvre : vr.config.cjs, env overrides, TurboSnap, sharding, exports compare UI.
`);
};

const check = (ok: boolean, pass: string, fail: string): CheckResult => ({
  ok,
  message: ok ? `✅ ${pass}` : `❌ ${fail}`,
});

const runStaticChecks = (): CheckResult[] => {
  const results: CheckResult[] = [];

  results.push(
    check(
      existsSync(path.join(PROJECT_ROOT, VR_CONFIG_FILENAME)),
      `${VR_CONFIG_FILENAME} présent`,
      `${VR_CONFIG_FILENAME} absent à la racine`,
    ),
  );

  results.push(
    check(
      !existsSync(path.join(PROJECT_ROOT, LEGACY_CONFIG)),
      `Pas de ${LEGACY_CONFIG} (migration OK)`,
      `${LEGACY_CONFIG} encore présent — migrer vers ${VR_CONFIG_FILENAME}`,
    ),
  );

  try {
    const fileConfig = loadVrConfig(PROJECT_ROOT);
    results.push(
      check(
        fileConfig.devices.length > 0,
        `loadVrConfig() : ${fileConfig.devices.length} device(s)`,
        "loadVrConfig() : devices vide",
      ),
    );
  } catch {
    results.push(check(false, "", "loadVrConfig() a échoué"));
  }

  const config = resolveVrConfig(PROJECT_ROOT);
  results.push(
    check(
      config.compare.mode === "incremental" || config.compare.mode === "full",
      `compare.mode = ${config.compare.mode}`,
      `compare.mode invalide : ${config.compare.mode}`,
    ),
  );

  const publicConfig = getVrPublicConfig(PROJECT_ROOT);
  results.push(
    check(
      publicConfig.deviceCount === config.devices.length,
      `getVrPublicConfig() : ${publicConfig.deviceCount} device(s), storybook ${publicConfig.storybookUrl}`,
      "getVrPublicConfig() incohérent",
    ),
  );

  const gitignore = readFileSync(path.join(PROJECT_ROOT, ".gitignore"), "utf8");
  results.push(
    check(gitignore.includes(".vr-cache"), ".gitignore contient .vr-cache/", ".gitignore : .vr-cache/ manquant"),
  );

  const prevConcurrency = process.env.VR_CONCURRENCY;
  process.env.VR_CONCURRENCY = "2";
  const overridden = resolveVrConfig(PROJECT_ROOT).capture.concurrency;
  if (prevConcurrency === undefined) delete process.env.VR_CONCURRENCY;
  else process.env.VR_CONCURRENCY = prevConcurrency;
  results.push(
    check(
      overridden === 2,
      "VR_CONCURRENCY=2 override capture.concurrency",
      `VR_CONCURRENCY override échoué (obtenu ${overridden})`,
    ),
  );

  results.push(
    check(
      typeof compareSelectedStories === "function" &&
        typeof compareByType === "function" &&
        typeof compareAllStories === "function",
      "Exports compare UI : compareSelectedStories, compareByType, compareAllStories",
      "Exports compare UI manquants",
    ),
  );

  const statsPath = path.join(PROJECT_ROOT, config.compare.statsFile);
  if (existsSync(statsPath)) {
    try {
      const raw = readFileSync(statsPath, "utf8");
      const stats = JSON.parse(raw) as { modules?: unknown[] };
      const graph = buildImportersGraph((stats.modules ?? []) as Parameters<typeof buildImportersGraph>[0]);
      results.push(
        check(
          graph.modules.size > 0,
          `TurboSnap : preview-stats.json OK (${graph.modules.size} modules source)`,
          "TurboSnap : graphe vide",
        ),
      );
    } catch {
      results.push(check(false, "", "TurboSnap : preview-stats.json illisible"));
    }
  } else {
    results.push({
      ok: true,
      message: `⚠️  preview-stats.json absent (${config.compare.statsFile}) — fallback statique au compare`,
    });
  }

  const dummyTasks: CaptureTask[] = [
    { storyId: "a--x", deviceName: "d1", componentDir: "src/a" },
    { storyId: "b--x", deviceName: "d1", componentDir: "src/b" },
    { storyId: "c--x", deviceName: "d1", componentDir: "src/c" },
    { storyId: "d--x", deviceName: "d1", componentDir: "src/d" },
  ];
  const shards = partitionTasksByShardTotal(dummyTasks, 2);
  const counts = shards.map(s => s.length);
  const ciMs = estimateCiWallClockMs(counts, 2, 1000, 0);
  results.push(
    check(
      shards.length === 2 && counts.reduce((a, b) => a + b, 0) === dummyTasks.length && ciMs > 0,
      `Sharding simulation : [${counts.join(", ")}] tâches sur 2 shards`,
      "Sharding simulation échouée",
    ),
  );

  results.push(
    check(
      typeof waitForStoryStable === "function" &&
        typeof shouldUseBurstCapture === "function" &&
        typeof expectsVrStoryPlay === "function" &&
        typeof appendVrCaptureParam === "function",
      "SteadySnap : exports vr-steadysnap OK",
      "SteadySnap : exports manquants",
    ),
  );

  results.push(
    check(
      config.compare.diffVerificationMaxAttempts >= 1,
      `Diff verify : diffVerificationMaxAttempts=${config.compare.diffVerificationMaxAttempts}`,
      "Diff verify : diffVerificationMaxAttempts invalide",
    ),
  );

  results.push(
    check(
      typeof getDiffVerificationMaxAttempts === "function" &&
        typeof shouldRetryDiffVerification === "function" &&
        shouldRetryDiffVerification(1, "diff", 3) &&
        !shouldRetryDiffVerification(3, "diff", 3) &&
        !shouldRetryDiffVerification(1, "match", 3),
      "Diff verify : logique shouldRetryDiffVerification OK",
      "Diff verify : shouldRetryDiffVerification échoué",
    ),
  );

  results.push(
    check(
      config.stabilize.burstCapture === false,
      `SteadySnap : burstCapture=${config.stabilize.burstCapture}`,
      "SteadySnap : defaults stabilize invalides",
    ),
  );

  results.push(
    check(
      appendVrCaptureParam("http://localhost:6006/iframe.html?id=demo--x").includes("vr-capture=1"),
      "SteadySnap : param vr-capture=1 sur iframe URL",
      "SteadySnap : appendVrCaptureParam échoué",
    ),
  );

  results.push(
    check(
      shouldUseBurstCapture(config, ["burst-vr"]) && !shouldUseBurstCapture(config, []),
      "SteadySnap : tag burst-vr active le burst",
      "SteadySnap : shouldUseBurstCapture échoué",
    ),
  );

  results.push(
    check(
      shouldUseBurstCapture(config, [], { stabilize: { burstIntervalMs: 1000 } }) &&
        !shouldUseBurstCapture(config, [], null),
      "SteadySnap : parameters.vr.stabilize.burstIntervalMs active le burst",
      "SteadySnap : override burstIntervalMs échoué",
    ),
  );

  const merged = resolveEffectiveVrConfig(config, {
    stabilize: { burstIntervalMs: 1000 },
    diffVerificationMaxAttempts: 5,
  });
  results.push(
    check(
      merged.stabilize.burstIntervalMs === 1000 &&
        merged.compare.diffVerificationMaxAttempts === 5 &&
        merged.stabilize.freezeAnimations === config.stabilize.freezeAnimations,
      "Story config : resolveEffectiveVrConfig fusionne overrides partiels",
      "Story config : resolveEffectiveVrConfig échoué",
    ),
  );

  results.push(
    check(
      normalizeStoryVrParameters({ stabilize: { burstIntervalMs: 1000 }, diffVerificationMaxAttempts: 2 }) !== null &&
        normalizeStoryVrParameters({ foo: "bar" }) === null,
      "Story config : normalizeStoryVrParameters OK",
      "Story config : normalizeStoryVrParameters échoué",
    ),
  );

  results.push(
    check(
      expectsVrStoryPlay(["play-fn"]) && !expectsVrStoryPlay(["play-fn", "skip-play-vr"]),
      "SteadySnap : attente play-fn / skip-play-vr OK",
      "SteadySnap : expectsVrStoryPlay échoué",
    ),
  );

  results.push(
    check(
      LIVE_ANIMATION_VR_TAG === "live-animation-vr",
      "SteadySnap : tag live-animation-vr défini",
      "SteadySnap : tag live-animation-vr manquant",
    ),
  );

  return results;
};

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
        componentDir: path.dirname(story.importPath).replace(/\\/g, "/"),
      });
    }
  }
  return tasks;
};

const runStorybookChecks = async (): Promise<CheckResult[]> => {
  const results: CheckResult[] = [];
  const config = resolveVrConfig(PROJECT_ROOT);
  const ready = await waitForStorybookStories(1, 10, PROJECT_ROOT);

  results.push(
    check(
      ready,
      `Storybook prêt (${config.storybook.url})`,
      `Storybook indisponible — lancez yarn storybook ou yarn vr`,
    ),
  );

  if (!ready) return results;

  const stories = await fetchStories();
  const allTasks = buildAllTasks(stories);
  const deviceCount = Object.keys(getDevicesConfig(config.devices)).length;

  results.push(
    check(
      stories.length > 0,
      `${stories.length} stories × ${deviceCount} devices = ${allTasks.length} tâches`,
      "Aucune story VR éligible",
    ),
  );

  const changed = getChangedFiles(PROJECT_ROOT, config);
  const { tasks: incrementalTasks } = filterCaptureTasks(allTasks, config, stories, {
    projectRoot: PROJECT_ROOT,
    publicScreenshotsDir: path.join(PROJECT_ROOT, "public", "Screenshots"),
    changedFiles: changed,
  });

  if (changed.files.length === 0 && !changed.requiresFullRun) {
    results.push(
      check(
        incrementalTasks.length === 0,
        "Incrémental sans changement → 0 tâche à capturer",
        `Incrémental sans changement : ${incrementalTasks.length} tâche(s) inattendue(s)`,
      ),
    );
  } else {
    results.push({
      ok: true,
      message: `ℹ️  Incrémental : ${incrementalTasks.length}/${allTasks.length} tâche(s) (${changed.files.length} fichier(s) modifié(s))`,
    });
  }

  const shard2 = partitionTasksByShardTotal(incrementalTasks.length > 0 ? incrementalTasks : allTasks, 2);
  const shardCounts = shard2.map(s => s.length);
  const total = shardCounts.reduce((a, b) => a + b, 0);
  const base = incrementalTasks.length > 0 ? incrementalTasks.length : allTasks.length;
  results.push(
    check(
      Math.abs(total - base) <= 0 && shardCounts.every(c => c >= 0),
      `Sharding VR_SHARD_TOTAL=2 : [${shardCounts.join(", ")}] / ${base} tâches`,
      "Répartition shard incorrecte",
    ),
  );

  return results;
};

const main = async () => {
  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  console.log("\n🧪 Validation Phases 0–9\n");

  const checks = runStaticChecks();

  if (!isStaticOnly) {
    checks.push(...(await runStorybookChecks()));
  } else {
    checks.push({ ok: true, message: "ℹ️  Mode --static-only : checks Storybook ignorés" });
  }

  console.log("── Résultat ──");
  checks.forEach(c => console.log(c.message));

  const allOk = checks.every(c => c.ok);
  console.log(allOk ? "\n✅ Validation Phases 0–9 OK.\n" : "\n❌ Points à corriger ci-dessus.\n");
  process.exit(allOk ? 0 : 1);
};

main().catch(err => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
