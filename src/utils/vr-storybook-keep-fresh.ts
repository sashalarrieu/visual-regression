/**
 * Garde le Storybook du sidecar à jour tant que le daemon tourne.
 *
 * Docker Desktop (bind mount macOS/Windows) : inotify ne voit pas les saves
 * de l'hôte → Vite HMR et le rebuild static restent figés. Le bind mount
 * **met à jour mtime+size** : on poll ça (~50 ms), pas un SHA1 de tout le
 * repo (~7k fichiers / ~10 s, event loop bloquée = keep-fresh mort).
 *
 *   - dev    : `utimes` des fichiers changés (inotify intra-conteneur) ;
 *   - static : rebuild storybook-static (cache Vite vidé).
 */
import { cpSync, existsSync, readFileSync, utimesSync, writeFileSync } from "fs";
import path from "path";

import {
  collectStorybookInputFilesAsync,
  diffStorybookInputSnapshots,
  snapshotStorybookInputStats,
  storybookInputDiffHasChanges,
  type StorybookInputDiff,
  type StorybookMode,
} from "./vr-storybook-runtime";

export const STORYBOOK_KEEP_FRESH_INTERVAL_MS = 800;
export const STORYBOOK_KEEP_FRESH_DEBOUNCE_MS = 1200;
export const STORYBOOK_KEEP_FRESH_LIST_REFRESH_MS = 8000;

/** Recopie file: visual-regression → node_modules du sidecar (entrypoint le fait au boot uniquement). */
export const syncLinkedVrSourcesIntoNodeModules = (projectRoot: string): boolean => {
  if (process.env.VR_DOCKER !== "1") return false;
  const linkedSrc = "/visual-regression";
  if (!existsSync(path.join(linkedSrc, "src"))) return false;
  const dest = path.join(projectRoot, "node_modules", "@setshao", "visual-regression");
  if (!existsSync(dest)) return false;
  try {
    const realDest = path.resolve(dest);
    if (realDest === path.resolve(linkedSrc)) return false;
    cpSync(path.join(linkedSrc, "src"), path.join(dest, "src"), { recursive: true, force: true });
    if (existsSync(path.join(linkedSrc, "bin"))) {
      cpSync(path.join(linkedSrc, "bin"), path.join(dest, "bin"), { recursive: true, force: true });
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Touche mtime (et le dossier parent) pour que le watcher inotify de Vite/Storybook
 * voit le changement. Origine = process du conteneur → l'événement est reçu.
 */
export const nudgeFsWatchers = (files: string[]): void => {
  const now = new Date();
  const dirs = new Set<string>();
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      utimesSync(file, now, now);
    } catch {
      try {
        writeFileSync(file, readFileSync(file));
      } catch {
        continue;
      }
    }
    dirs.add(path.dirname(file));
  }
  for (const dir of dirs) {
    try {
      utimesSync(dir, now, now);
    } catch {
      // ignore
    }
  }
};

export const filesToNudgeFromDiff = (diff: StorybookInputDiff): string[] => [...diff.changed, ...diff.added];

export type StorybookKeepFreshHandle = {
  stop: () => void;
  refresh: () => Promise<{ changed: boolean }>;
};

export const startStorybookKeepFresh = (options: {
  projectRoot: string;
  mode: StorybookMode;
  intervalMs?: number;
  debounceMs?: number;
  onDevChange: (files: string[]) => Promise<void>;
  onStaticChange: () => Promise<void>;
}): StorybookKeepFreshHandle => {
  const intervalMs = options.intervalMs ?? STORYBOOK_KEEP_FRESH_INTERVAL_MS;
  const debounceMs = options.debounceMs ?? STORYBOOK_KEEP_FRESH_DEBOUNCE_MS;
  let files: string[] = [];
  let previous = new Map<string, string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let listRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let refreshingList = false;

  const statsSnapshot = (): Map<string, string> => snapshotStorybookInputStats(files);

  const isLinkedVrFile = (file: string): boolean =>
    file.includes(`${path.sep}visual-regression${path.sep}src${path.sep}`) || file.startsWith("/visual-regression/");

  const flush = async (): Promise<{ changed: boolean }> => {
    if (stopped) return { changed: false };
    if (!refreshingList) {
      files = await collectStorybookInputFilesAsync(options.projectRoot);
    }
    const next = statsSnapshot();
    const diff = diffStorybookInputSnapshots(previous, next);
    if (!storybookInputDiffHasChanges(diff)) return { changed: false };
    previous = next;
    const changedFiles = filesToNudgeFromDiff(diff);
    if (changedFiles.some(isLinkedVrFile)) {
      if (syncLinkedVrSourcesIntoNodeModules(options.projectRoot)) {
        files = await collectStorybookInputFilesAsync(options.projectRoot);
        previous = statsSnapshot();
      }
    }
    console.log(
      `🔄 [vr-storybook] Sources modifiées (${diff.changed.length} edit, ${diff.added.length} +, ${diff.removed.length} −) — ${options.mode === "static" ? "rebuild static" : "nudge HMR"}`,
    );
    if (options.mode === "static") {
      await options.onStaticChange();
    } else {
      await options.onDevChange(changedFiles);
    }
    return { changed: true };
  };

  const enqueueFlush = (): Promise<{ changed: boolean }> => {
    const run = chain.then(flush, flush);
    chain = run.catch(() => undefined);
    return run;
  };

  const scheduleFlush = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void enqueueFlush();
    }, debounceMs);
  };

  const refreshFileList = async (): Promise<void> => {
    if (stopped || refreshingList) return;
    refreshingList = true;
    try {
      const nextFiles = await collectStorybookInputFilesAsync(options.projectRoot);
      if (stopped) return;
      files = nextFiles;
      const next = statsSnapshot();
      if (storybookInputDiffHasChanges(diffStorybookInputSnapshots(previous, next))) {
        scheduleFlush();
      } else {
        previous = next;
      }
    } catch (error) {
      console.warn("[vr-storybook] Keep-fresh refresh liste échoué:", error instanceof Error ? error.message : error);
    } finally {
      refreshingList = false;
    }
  };

  const tick = (): void => {
    if (stopped) return;
    try {
      const next = statsSnapshot();
      if (storybookInputDiffHasChanges(diffStorybookInputSnapshots(previous, next))) {
        scheduleFlush();
      }
    } catch (error) {
      console.warn("[vr-storybook] Keep-fresh tick échoué:", error instanceof Error ? error.message : error);
    }
    timer = setTimeout(tick, intervalMs);
  };

  const scheduleListRefresh = (): void => {
    if (stopped) return;
    listRefreshTimer = setTimeout(() => {
      void refreshFileList().finally(scheduleListRefresh);
    }, STORYBOOK_KEEP_FRESH_LIST_REFRESH_MS);
  };

  const bootPromise = (async (): Promise<void> => {
    try {
      files = await collectStorybookInputFilesAsync(options.projectRoot);
      previous = statsSnapshot();
      console.log(`🟢 [vr-storybook] Keep-fresh actif (${files.length} fichiers, poll mtime — mode ${options.mode})`);
    } catch (error) {
      console.warn("[vr-storybook] Keep-fresh boot échoué:", error instanceof Error ? error.message : error);
      files = [];
      previous = new Map();
    }
    if (stopped) return;
    timer = setTimeout(tick, intervalMs);
    scheduleListRefresh();
  })();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (listRefreshTimer) clearTimeout(listRefreshTimer);
    },
    refresh: async () => {
      await bootPromise;
      return enqueueFlush();
    },
  };
};
