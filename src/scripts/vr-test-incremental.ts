/**
 * Vérifie les prérequis du mode incrémental (Session 3–4) puis lance vr:compare.
 *
 * Usage :
 *   yarn vr:test-incremental              → checks + compare si OK
 *   yarn vr:test-incremental --check-only → checks uniquement
 *   yarn vr:test-incremental --help
 */
import { existsSync, readdirSync } from "fs";
import path from "path";

import { FORCE_VR_TAG, IGNORE_VR_TAG, SCREENSHOT_EXTENSION, SCREENSHOT_NAME } from "../constants/constants";
import {
  getDevicesConfig,
  getProjectPaths,
  getProjectRoot,
  resolveVrConfig,
  waitForStorybookStories,
} from "../utils/node";
import {
  filterCaptureTasks,
  getChangedFiles,
  getGlobalTriggerMatches,
  type StoryIndexEntry,
} from "../utils/vr-incremental";

import { compareVisualRegressions } from "./compare-visual-regressions";
import type { CaptureTask } from "./vr-capture-engine";

const PROJECT_ROOT = getProjectRoot();
const { publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR } = getProjectPaths(PROJECT_ROOT);

/** Scope git pour ce script : working tree uniquement (ignore les commits branche vs origin/main). */
const TEST_COMPARE_SCOPE = "working-tree" as const;

/** Fichier demo suggéré pour un test incrémental isolé. */
const SUGGESTED_DEMO_FILE = "src/demo/components/DemoButton/DemoButton.tsx";

type CheckResult = { ok: boolean; message: string };

const isCheckOnly = process.argv.includes("--check-only");
const showHelp = process.argv.includes("--help") || process.argv.includes("-h");

const printHelp = (): void => {
  console.log(`
Test du mode incrémental VR (Session 3–4, TurboSnap)

Usage:
  yarn vr:test-incremental              Vérifie les prérequis puis lance yarn vr:compare
  yarn vr:test-incremental --check-only Vérifie sans lancer la comparaison

Prérequis vérifiés:
  • Storybook accessible (yarn storybook ou yarn vr)
  • compare.mode = incremental dans vr.config.cjs
  • Aucun global trigger dans le working tree (vr.config.cjs, package.json, .storybook/**, …)
  • Au moins un fichier modifié localement (non commité ou staged)
  • Baselines demo présentes dans src/**/Screenshots/

Note: scope working-tree — les commits branche vs origin/main sont ignorés.
Pour CI/PR, utilisez compare.scope = all (défaut) dans vr.config.cjs.

Pour un test propre:
  1. Modifier uniquement ${SUGGESTED_DEMO_FILE} (commit ou non)
  2. yarn vr:test-incremental
`);
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

const countDemoBaselines = (): number => {
  const demoRoot = path.join(PROJECT_ROOT, "src", "demo");
  if (!existsSync(demoRoot)) return 0;

  let count = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Screenshots") {
          count += readdirSync(full).filter(
            f => f.endsWith(SCREENSHOT_EXTENSION) && f.includes(SCREENSHOT_NAME),
          ).length;
          continue;
        }
        walk(full);
      }
    }
  };
  walk(demoRoot);
  return count;
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

const runChecks = async (): Promise<boolean> => {
  console.log("\n🧪 Test mode incrémental VR (Session 3–4, TurboSnap)\n");

  const config = resolveVrConfig(PROJECT_ROOT);
  const checks: CheckResult[] = [];

  checks.push({
    ok: true,
    message: `✅ Scope git : ${TEST_COMPARE_SCOPE} (working tree — commits branche vs ${config.compare.base} ignorés)`,
  });

  // Storybook
  const storybookReady = await waitForStorybookStories(1, 15);
  checks.push({
    ok: storybookReady,
    message: storybookReady
      ? `✅ Storybook prêt (${config.storybook.url})`
      : `❌ Storybook indisponible — lancez yarn storybook ou yarn vr`,
  });

  // Mode incremental
  checks.push({
    ok: config.compare.mode === "incremental",
    message:
      config.compare.mode === "incremental"
        ? "✅ compare.mode = incremental"
        : `❌ compare.mode = ${config.compare.mode} — attendu "incremental" (ou VR_COMPARE_MODE=incremental)`,
  });

  const changed = getChangedFiles(PROJECT_ROOT, config, { scope: TEST_COMPARE_SCOPE });

  const branchChanged = getChangedFiles(PROJECT_ROOT, config, { scope: "all" });
  const branchTriggers = getGlobalTriggerMatches(branchChanged.files, config);
  if (branchTriggers.length > 0 && getGlobalTriggerMatches(changed.files, config).length === 0) {
    console.log(
      `\nℹ️  Votre branche contient des global triggers vs ${config.compare.base} (${branchTriggers.slice(0, 4).join(", ")}${branchTriggers.length > 4 ? "…" : ""}) — ignorés pour ce test local.`,
    );
  }

  if (changed.requiresFullRun) {
    checks.push({
      ok: false,
      message:
        "❌ Pas de git ni manifest — lancez d'abord un yarn vr:compare complet pour créer .vr-cache/manifest.json",
    });
  } else {
    checks.push({
      ok: true,
      message: `✅ Source des changements : ${changed.source} (${changed.files.length} fichier(s))`,
    });
  }

  const triggerMatches = getGlobalTriggerMatches(changed.files, config);
  if (triggerMatches.length > 0) {
    checks.push({
      ok: false,
      message: `❌ Global trigger(s) dans les fichiers modifiés — commit/stash requis avant test incrémental`,
    });
    console.log("   Fichiers concernés :");
    triggerMatches.slice(0, 12).forEach(f => console.log(`   • ${f}`));
    if (triggerMatches.length > 12) {
      console.log(`   … et ${triggerMatches.length - 12} autre(s)`);
    }
  } else if (!changed.requiresFullRun) {
    checks.push({ ok: true, message: "✅ Aucun global trigger dans les fichiers modifiés" });
  }

  const demoChanges = changed.files.filter(f => f.replace(/\\/g, "/").startsWith("src/demo/"));
  if (!changed.requiresFullRun && changed.files.length === 0) {
    checks.push({
      ok: false,
      message: `❌ Aucun fichier modifié — éditez par ex. ${SUGGESTED_DEMO_FILE} puis relancez`,
    });
  } else if (!changed.requiresFullRun && demoChanges.length > 0) {
    checks.push({
      ok: true,
      message: `✅ ${demoChanges.length} changement(s) sous src/demo/ (idéal pour Session 3)`,
    });
    demoChanges.slice(0, 8).forEach(f => console.log(`   • ${f}`));
  } else if (!changed.requiresFullRun && changed.files.length > 0) {
    checks.push({
      ok: true,
      message: `⚠️  Changements hors src/demo/ (${changed.files.length} fichier(s)) — incrémental actif mais périmètre élargi`,
    });
    changed.files.slice(0, 8).forEach(f => console.log(`   • ${f}`));
    if (changed.files.length > 8) console.log(`   … et ${changed.files.length - 8} autre(s)`);
  }

  const baselineCount = countDemoBaselines();
  checks.push({
    ok: baselineCount > 0,
    message:
      baselineCount > 0
        ? `✅ ${baselineCount} baseline(s) demo dans src/**/Screenshots/`
        : "❌ Aucune baseline demo — lancez yarn vr:compare une fois pour générer les screenshots",
  });

  // Simulation filtrage
  if (storybookReady && !changed.requiresFullRun && triggerMatches.length === 0 && changed.files.length > 0) {
    try {
      const stories = await fetchStories();
      const allTasks = buildAllTasks(stories);
      const { tasks, skipped, reason } = filterCaptureTasks(allTasks, config, stories, {
        projectRoot: PROJECT_ROOT,
        publicScreenshotsDir: PUBLIC_SCREENSHOTS_DIR,
        changedFiles: changed,
      });
      console.log(
        `\n📦 Simulation : ${tasks.length}/${allTasks.length} tâche(s) à capturer (${skipped} ignorée(s)) | reason=${reason}`,
      );
      if (tasks.length === allTasks.length) {
        checks.push({
          ok: false,
          message: "❌ Toutes les tâches seraient capturées — le filtrage incrémental ne réduit pas le scope",
        });
      } else if (tasks.length === 0) {
        checks.push({
          ok: false,
          message: "❌ 0 tâche à capturer — vérifiez que le fichier modifié correspond à une story demo",
        });
      } else {
        checks.push({
          ok: true,
          message: `✅ Filtrage incrémental OK (${tasks.length} tâche(s) au lieu de ${allTasks.length})`,
        });
      }
    } catch (err) {
      checks.push({
        ok: false,
        message: `❌ Simulation filtrage échouée : ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  console.log("\n── Résultat des vérifications ──");
  checks.forEach(c => console.log(c.message));

  const allOk = checks.every(c => c.ok);
  console.log(
    allOk ? "\n✅ Prêt pour un test incrémental.\n" : "\n❌ Corrigez les points ci-dessus avant de tester.\n",
  );
  return allOk;
};

const main = async () => {
  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  const ok = await runChecks();
  if (!ok) {
    process.exit(1);
  }

  if (isCheckOnly) {
    console.log("Mode --check-only : comparaison non lancée. Exécutez yarn vr:compare quand vous êtes prêt.");
    process.exit(0);
  }

  console.log("🚀 Lancement de la comparaison incrémentale…\n");
  process.env.VR_COMPARE_SCOPE = TEST_COMPARE_SCOPE;
  await compareVisualRegressions();
};

main().catch(err => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
