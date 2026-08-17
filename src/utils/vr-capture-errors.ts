/**
 * Persistance des erreurs de capture (story × device) dans `.vr-cache/capture-errors.json`.
 * Mis à jour après chaque batch : succès → retrait ; échec → upsert.
 * Les stories ignore-vr n’y entrent jamais (non capturables).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { CaptureErrorItem } from "../types/types";

import { getStorybookUrl } from "./node";
import { collectIgnoredVrStoryIds } from "./vr-story-eligibility";
import { fetchStorybookIndexEntries } from "./vr-storybook-index";

export type { CaptureErrorItem };

export type CaptureErrorsFile = {
  items: CaptureErrorItem[];
};

export const captureErrorKey = (storyId: string, deviceName: string): string => `${deviceName}::${storyId}`;

export const getCaptureErrorsPath = (projectRoot: string): string =>
  path.join(projectRoot, ".vr-cache", "capture-errors.json");

/** Retire les erreurs dont la story est taguée ignore-vr. */
export const withoutIgnoredCaptureErrors = (
  items: CaptureErrorItem[],
  ignoredStoryIds: ReadonlySet<string>,
): CaptureErrorItem[] =>
  ignoredStoryIds.size === 0 ? items : items.filter(item => !ignoredStoryIds.has(item.storyId));

export const readCaptureErrors = (projectRoot: string): CaptureErrorItem[] => {
  try {
    const filePath = getCaptureErrorsPath(projectRoot);
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CaptureErrorsFile | CaptureErrorItem[];
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item): item is CaptureErrorItem =>
        Boolean(item) &&
        typeof item.storyId === "string" &&
        typeof item.deviceName === "string" &&
        typeof item.message === "string",
    );
  } catch {
    return [];
  }
};

export const writeCaptureErrors = (projectRoot: string, items: CaptureErrorItem[]): void => {
  try {
    const filePath = getCaptureErrorsPath(projectRoot);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: CaptureErrorsFile = { items };
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    // best-effort — ne pas faire échouer la capture
  }
};

const sortCaptureErrors = (items: CaptureErrorItem[]): CaptureErrorItem[] =>
  [...items].sort((a, b) => {
    const byStory = a.storyId.localeCompare(b.storyId);
    if (byStory !== 0) return byStory;
    return a.deviceName.localeCompare(b.deviceName);
  });

/**
 * Met à jour le store pour les tâches résolues uniquement (les autres restent inchangées).
 * - `succeeded` : retirées de la liste
 * - `failed` : upsert (message / timestamp / componentDir)
 */
export const syncCaptureErrorsAfterBatch = (
  projectRoot: string,
  update: {
    succeeded: { storyId: string; deviceName: string }[];
    failed: CaptureErrorItem[];
  },
  ignoredStoryIds: ReadonlySet<string> = new Set(),
): CaptureErrorItem[] => {
  const byKey = new Map(
    withoutIgnoredCaptureErrors(readCaptureErrors(projectRoot), ignoredStoryIds).map(item => [
      captureErrorKey(item.storyId, item.deviceName),
      item,
    ]),
  );

  for (const item of update.succeeded) {
    byKey.delete(captureErrorKey(item.storyId, item.deviceName));
  }

  for (const item of withoutIgnoredCaptureErrors(update.failed, ignoredStoryIds)) {
    byKey.set(captureErrorKey(item.storyId, item.deviceName), {
      storyId: item.storyId,
      deviceName: item.deviceName,
      componentDir: item.componentDir || "",
      message: item.message || "Capture failed",
      at: item.at || Date.now(),
    });
  }

  const next = sortCaptureErrors(withoutIgnoredCaptureErrors(Array.from(byKey.values()), ignoredStoryIds));
  writeCaptureErrors(projectRoot, next);
  return next;
};

/** Applique le résultat d’un batch (tâches tentées + erreurs structurées). */
export const syncCaptureErrorsFromBatch = (
  projectRoot: string,
  attempted: { storyId: string; deviceName: string; componentDir: string }[],
  failed: CaptureErrorItem[],
  ignoredStoryIds: ReadonlySet<string> = new Set(),
): CaptureErrorItem[] => {
  const failedFiltered = withoutIgnoredCaptureErrors(failed, ignoredStoryIds);
  const failedKeys = new Set(failedFiltered.map(item => captureErrorKey(item.storyId, item.deviceName)));
  const succeeded = attempted.filter(task => !failedKeys.has(captureErrorKey(task.storyId, task.deviceName)));
  return syncCaptureErrorsAfterBatch(projectRoot, { succeeded, failed: failedFiltered }, ignoredStoryIds);
};

/** Marque toutes les tâches tentées en erreur (daemon down, échec global). */
export const syncCaptureErrorsAllFailed = (
  projectRoot: string,
  attempted: { storyId: string; deviceName: string; componentDir: string }[],
  message: string,
  ignoredStoryIds: ReadonlySet<string> = new Set(),
): CaptureErrorItem[] => {
  const at = Date.now();
  const failed: CaptureErrorItem[] = attempted.map(task => ({
    storyId: task.storyId,
    deviceName: task.deviceName,
    componentDir: task.componentDir,
    message,
    at,
  }));
  return syncCaptureErrorsFromBatch(projectRoot, attempted, failed, ignoredStoryIds);
};

/**
 * Purge les entrées ignore-vr du fichier (stale) via index Storybook.
 * Réécrit le fichier si des lignes sont retirées.
 */
export const purgeIgnoredCaptureErrors = async (projectRoot: string): Promise<CaptureErrorItem[]> => {
  const entries = await fetchStorybookIndexEntries(getStorybookUrl(projectRoot));
  const ignoredStoryIds = collectIgnoredVrStoryIds(entries);
  const current = readCaptureErrors(projectRoot);
  const next = withoutIgnoredCaptureErrors(current, ignoredStoryIds);
  if (next.length !== current.length) {
    writeCaptureErrors(projectRoot, next);
  }
  return next;
};
